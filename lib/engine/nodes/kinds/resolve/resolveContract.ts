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
import { extractJson } from "../agent/jsonSchemaLite";
import {
  AGENT_OUTPUT_ERROR,
  AgentOutputError,
  type AgentOutputIssue,
} from "../../shared/agent/outputError/outputErrorExports";
import { TemplateRenderer } from "../../shared/templateRenderer";
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
    const parsed = extractJson(text ?? "");
    if (parsed == null) {
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.NO_JSON,
        label: this.label,
        message: `${this.label}: the agent response contained no JSON — the resolve response must be a single JSON object`,
        issues: [],
        response: text,
      });
    }
    // the agent's escape hatch: it answered with the standard error envelope
    // instead of contract-conforming output — convey its reason
    const reported = AgentOutputError.reported(parsed);
    if (reported != null) {
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.AGENT_REPORTED,
        label: this.label,
        // the agent's reason is the headline — its words, conveyed to the user
        message: `${this.label}: ${reported.reason}`,
        issues: [],
        reported,
        response: text,
      });
    }
    const result = ResolveAgentResponse.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
        label: this.label,
        // the first violation stays the headline — every issue in the payload
        message: issues[0]?.message ?? `${this.label}: the resolve response violated its schema`,
        issues,
        response: text,
      });
    }
    const issues = this.semanticIssues(result.data, openIds);
    if (issues.length) {
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
        label: this.label,
        message: issues[0]?.message ?? `${this.label}: the resolve response violated its schema`,
        issues,
        response: text,
      });
    }
    return result.data;
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
    const lines = open.map((row) => this.commentLine(row, replyDates.get(row.discussion_id ?? "") ?? null));

    const block = lines.join("\n");
    if (block.length <= RESOLVE_COMMENTS_BLOCK_CAP) {
      return { text: block, ids: open.map((row) => row.id) };
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
    const text = [...kept, RESOLVE_COMMENTS_TRUNCATION_NOTE].join("\n");
    return { text, ids: kept.length ? open.slice(0, kept.length).map((row) => row.id) : [] };
  }

  /**
   * ONE bounded retry prompt for a contract miss — the specific issues (the
   * first miss's own words) plus the re-stated directive carrying the exact
   * same exported JSON Schema, so the advertised and enforced contracts never
   * drift.
   */
  retryPrompt(failure: AgentOutputError, openIds: readonly string[]): string {
    const body =
      failure.code === AGENT_OUTPUT_ERROR.NO_JSON
        ? TemplateRenderer.compose("Your previous response could not be used: no JSON object could be parsed from it.")
            .addBlankLine()
            .addLine("Re-emit your ENTIRE response as a single JSON object.")
            .build()
        : TemplateRenderer.compose("Your previous response was valid JSON but violated the resolve contract:")
            .addBlankLine()
            .addLines(failure.detail.issues.map((i) => `  - ${i.path ? `${i.path}: ` : ""}${i.message}`))
            .addBlankLine()
            .addLine(
              `Re-emit a single JSON object with exactly one decision per open comment (${openIds.join(", ")}).`,
            )
            .build();
    return TemplateRenderer.compose(body)
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

  /**
   * Whether a comment row participates in the resolve loop: parsed from the
   * row's raw host JSON (the `commentService.listForFlow` pattern) — the host
   * never stores it as a dedicated column. Unparseable/absent raw defaults to
   * `true` (a resolvable review thread).
   */
  private commentResolvable(row: CommentRow): boolean {
    let parsed: Partial<{ resolvable: unknown }> = {};
    try {
      parsed = row.raw ? (JSON.parse(row.raw) as Partial<{ resolvable: unknown }>) : {};
    } catch {
      parsed = {};
    }
    return typeof parsed.resolvable === "boolean" ? parsed.resolvable : true;
  }

  private capText(value: string, cap: number): string {
    return value.length > cap ? `${value.slice(0, cap)}… (truncated)` : value;
  }

  /** One id-tagged line per open comment — the exact ids the decisions reference. */
  private commentLine(row: CommentRow, repliedAt: string | null): string {
    const meta: string[] = [];
    if (row.author) meta.push(`author: @${row.author}`);
    if (repliedAt) meta.push(`you replied on ${repliedAt.slice(0, 10)} — awaiting reviewer`);
    const metaPart = meta.length ? ` (${meta.join("; ")})` : "";
    const body = this.capText(row.body ?? "", RESOLVE_BODY_CAP);

    const location = row.file_path
      ? `${row.file_path}${row.line != null ? `:${row.line}` : ""}`
      : null;
    const marker = !this.commentResolvable(row) ? "(MR note, not resolvable)" : null;
    const head = [`[${row.id}]`, location ?? marker].filter(Boolean).join(" ");
    const separator = location || marker ? " — " : " ";
    return `- ${head}${separator}${body}${metaPart}`;
  }

  /** Latest same-thread agent reply date (yyyy-mm-dd), per discussion. */
  private latestAgentReplyDates(agentReplies: readonly CommentRow[]): Map<string, string> {
    const dates = new Map<string, string>();
    for (const r of agentReplies) {
      if (!r.discussion_id || r.resolved_by !== RESOLVED_BY_AGENT) continue;
      const prev = dates.get(r.discussion_id);
      if (!prev || r.created_at > prev) dates.set(r.discussion_id, r.created_at);
    }
    return dates;
  }
}
