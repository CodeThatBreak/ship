import "server-only";

/**
 * The resolve output contract (the `PlanOutputContract` precedent): validate
 * the resolve agent's response against the {@link ResolveAgentResponse}
 * schema, shape the presented open-comment list for the run prompt, and build
 * the ONE bounded retry prompt for contract misses. No DB, no host calls
 * here — pure behavior; the effect-apply half lives in `resolveEffects.ts`.
 *
 * Failure modes follow the standard `AgentOutputError` payload: `no_json`,
 * the agent's error envelope (`agent_reported` — the escape hatch, never
 * retried), and `schema_mismatch` (Zod shape, id coverage, per-action
 * refinements) carrying every violation. Contracts themselves live in
 * `schema.ts` and domain constants in `constants/` — this file is behavior.
 */
import {
  AgentOutputError,
  type AgentOutputIssue,
} from "../../shared/agent/outputError/outputErrorExports";
import { retryFeedbackBody } from "../../shared/agentOutput/utils/retryFeedback";
import { validateStandardAgentOutput } from "../../shared/agentOutput/utils/standardOutput";
import { TemplateRenderer } from "../../shared/templateRenderer";
import { untrustedData } from "../../../prompts/untrustedData";
import type { CommentRow } from "../../../../db/rows";
import {
  RESOLVE_COMMENT_ACTION,
  RESOLVED_BY_AGENT,
} from "./constants/commentActions";
import { RESOLVE_LABEL } from "./constants/label";
import {
  RESOLVE_BODY_CAP,
  RESOLVE_COMMENTS_BLOCK_CAP,
  RESOLVE_COMMENTS_TRUNCATION_NOTE,
} from "./constants/presentedComments";
import {
  ResolveAgentResponse,
  RESOLVE_RESPONSE_JSON_SCHEMA,
} from "./schema";
import type { PresentedComments } from "./types/presentedComments";
import { commentResolvable } from "./utils/commentResolvable";

/**
 * Validate, present, and retry the resolve contract — stateless (a single
 * shared instance is fine; dependencies arrive when finalize wires it).
 */
export class ResolveOutputContract {
  constructor(private readonly label: string = RESOLVE_LABEL) {}

  /**
   * Validate an agent response against the resolve contract:
   * `extractJson` → the agent's error envelope → the Zod shape → id coverage
   * (exactly one decision per presented id, unknown/duplicates rejected,
   * missing ids named) → per-action refinements (reply required for
   * answered/wontfix, `skipped` never resolves or replies). Zero presented
   * ids make `decisions: []` trivially valid.
   * Throws the standard {@link AgentOutputError}.
   */
  parse(text: string, openIds: readonly string[]): ResolveAgentResponse {
    // the standard validation (step 05 — the private copy is gone) plus the
    // resolve-domain semantic gate: exactly one decision per presented id
    return validateStandardAgentOutput({
      label: this.label,
      text,
      schema: ResolveAgentResponse,
      noJsonNote: "the resolve response must be a single JSON object",
      mismatchNote: `${this.label}: the resolve response violated its schema`,
      semantic: (value) => this.semanticIssues(value, openIds),
    });
  }

  /**
   * Render the open-comment list for the run prompt: deterministic order (the
   * caller's list is ordered by the `openComments` query), one id-tagged line
   * per row, per-comment bodies capped, and non-resolvable rows marked.
   * Same-thread agent replies (G11) add the "already replied — awaiting
   * reviewer" marker so the agent skips those threads on the next cycle
   * instead of re-answering its own words.
   */
  presentComments(
    open: readonly CommentRow[],
    agentReplies: readonly CommentRow[] = [],
  ): PresentedComments {
    const replyDates = this.latestAgentReplyDates(agentReplies);
    // the loud-cap signal travels back to the node (a pure class has no
    // support/ctx): one entry per cap that bit, for the caller's log event
    const truncations: string[] = [];
    const lines = open.map((row) => this.commentLine(row, replyDates.get(row.discussionId ?? "") ?? null, truncations));

    const block = lines.join("\n");
    if (block.length <= RESOLVE_COMMENTS_BLOCK_CAP) {
      return { text: block, ids: open.map((row) => row.id), truncations };
    }

    // keep whole id-tagged lines (each is a decision target) that fit, then the note
    const kept: string[] = [];
    let used = 0;
    const room = RESOLVE_COMMENTS_BLOCK_CAP - RESOLVE_COMMENTS_TRUNCATION_NOTE.length - 1;
    for (const line of lines) {
      const cost = used === 0 ? line.length : line.length + 1;
      if (used + cost > room) break;
      used += cost;
      kept.push(line);
    }
    truncations.push(
      `open-comment list capped to ${RESOLVE_COMMENTS_BLOCK_CAP} characters — ${open.length - kept.length} of ${open.length} comment(s) omitted`,
    );
    const text = [...kept, RESOLVE_COMMENTS_TRUNCATION_NOTE].join("\n");
    return { text, ids: kept.length ? open.slice(0, kept.length).map((row) => row.id) : [], truncations };
  }

  /**
   * ONE bounded retry prompt for a contract miss — the shared feedback body
   * (step 05) plus the resolve-domain rule, re-stating the directive carrying
   * the exact same exported JSON Schema, so the advertised and enforced
   * contracts never drift.
   */
  retryPrompt(failure: AgentOutputError, openIds: readonly string[]): string {
    const extra = `Re-emit a single JSON object with exactly one decision per open comment (${openIds.join(", ")}).`;
    return TemplateRenderer.compose(retryFeedbackBody(failure, { extraInstruction: extra }))
      .addBlankLine()
      .addBlankLine()
      .addLine(AgentOutputError.directive(RESOLVE_RESPONSE_JSON_SCHEMA))
      .build();
  }

  /** Coverage + per-action refinement violations — [] means the response is in-contract. */
  private semanticIssues(
    response: ResolveAgentResponse,
    openIds: readonly string[],
  ): AgentOutputIssue[] {
    const issues: AgentOutputIssue[] = [];
    const openIdSet = new Set(openIds);
    const covered = new Set<string>();

    response.decisions.forEach((d, i) => {
      const at = `decisions[${i}]`;
      if (!openIdSet.has(d.id)) {
        issues.push({
          path: `${at}.id`,
          message: `unknown comment id "${d.id}" — decisions must reference exactly the comments listed in the prompt`,
        });
      } else if (covered.has(d.id)) {
        issues.push({
          path: `${at}.id`,
          message: `duplicate decision for comment "${d.id}" — exactly one decision per comment`,
        });
      } else {
        covered.add(d.id);
      }
      if (d.action !== RESOLVE_COMMENT_ACTION.SKIPPED) {
        if (d.action !== RESOLVE_COMMENT_ACTION.FIXED && !d.reply) {
          issues.push({
            path: `${at}.reply`,
            message: `"${d.action}" requires a reply for comment "${d.id}" — the reviewer must see the answer in the thread`,
          });
        }
      } else {
        if (d.resolve) {
          issues.push({
            path: `${at}.resolve`,
            message: `"skipped" must be declared with resolve: false (comment "${d.id}")`,
          });
        }
        if (d.reply != null) {
          issues.push({
            path: `${at}.reply`,
            message: `"skipped" must not include a reply (comment "${d.id}")`,
          });
        }
      }
    });

    for (const id of openIds) {
      if (!covered.has(id)) {
        issues.push({ path: "decisions", message: `missing decision for comment "${id}"` });
      }
    }
    return issues;
  }

  /** One id-tagged line per open comment — the exact ids the decisions
   *  reference. The comment body is untrusted reviewer content: fenced through
   *  the shared `untrustedData` wrapper (cap kept at RESOLVE_BODY_CAP), and a
   *  cap that bite is recorded in `truncations` for the node's log event. */
  private commentLine(row: CommentRow, repliedAt: string | null, truncations: string[]): string {
    const meta: string[] = [];
    if (row.author) meta.push(`author: @${row.author}`);
    if (repliedAt) meta.push(`you replied on ${repliedAt.slice(0, 10)} — awaiting reviewer`);
    const metaPart = meta.length ? ` (${meta.join("; ")})` : "";
    const body = row.body ?? "";
    const fenced = body ? untrustedData({ source: `comment ${row.id}`, text: body, cap: RESOLVE_BODY_CAP }) : null;
    if (fenced?.truncated) {
      truncations.push(`comment ${row.id} body capped to ${RESOLVE_BODY_CAP} of ${fenced.originalLength} characters`);
    }
    const bodyPart = fenced?.text ?? "";

    const location = row.filePath
      ? `${row.filePath}${row.line != null ? `:${row.line}` : ""}`
      : null;
    const marker = !commentResolvable(row) ? "(MR note, not resolvable)" : null;
    const head = [`[${row.id}]`, location ?? marker].filter(Boolean).join(" ");
    const separator = location || marker ? " — " : " ";
    return `- ${head}${separator}${bodyPart}${metaPart}`;
  }

  /** Latest same-thread agent reply date (yyyy-mm-dd), per discussion. */
  private latestAgentReplyDates(agentReplies: readonly CommentRow[]): Map<string, string> {
    const dates = new Map<string, string>();
    for (const r of agentReplies) {
      if (!r.discussionId || r.resolvedBy !== RESOLVED_BY_AGENT) continue;
      const prev = dates.get(r.discussionId);
      if (!prev || r.createdAt > prev) dates.set(r.discussionId, r.createdAt);
    }
    return dates;
  }
}
