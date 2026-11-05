/**
 * ResolveEffects — applying the resolve contract (§3): the pure decision-matrix
 * planner, bounded host retry (G5), per-discussion dedupe (G9), never-host-call
 * non-resolvable threads (G8), the posted-reply self-ingestion guard (G10), and
 * the artifact ledger (§4). Fake GitHostResolver + injected retry sleep +
 * isolated temp SQLite DB (AGENTS.md §1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-resolve-effects-")),
  "test.db",
);

const { db } = await import("../../../../db/app");
const { NodeSupport } = await import("../../shared/nodeSupport");
const { ResolveEffects, planResolveEffects } = await import("./resolveEffects");
const { RESOLVE_COMMENT_ACTION } = await import("./constants/commentActions");
const { PUSH_STATE } = await import("./constants/pushState");
const { GitHostApiError } = await import("../../../ports/gitHostErrors");

import type { GitHostResolver } from "../../../ports/gitHost";
import type { CommentRow } from "../../../../db/rows";
import type { ResolveAgentResponse, ResolveCommentDecision } from "./schema";
import type { ResolveEffectInput, ResolveEffectLedger } from "./types/resolveEffects";

const now = () => new Date().toISOString();

// ── fixtures ─────────────────────────────────────────────────────────────────

const decision = (
  id: string,
  action: ResolveCommentDecision["action"],
  extra: Partial<ResolveCommentDecision> = {},
): ResolveCommentDecision => ({
  id,
  action,
  resolve: action !== RESOLVE_COMMENT_ACTION.SKIPPED,
  ...extra,
});

const response = (...decisions: ResolveCommentDecision[]): ResolveAgentResponse => ({
  summary: "handled the review comments",
  codeChanged: decisions.some((d) => d.action === RESOLVE_COMMENT_ACTION.FIXED),
  decisions,
});

/** In-memory comment row for the pure planner (the resolveContract.test row shape). */
const row = (id: string, discussionId: string | null = `d_${id}`, raw: string | null = null): CommentRow => ({
  id,
  flow_id: "flw_resolve_effects",
  mr_iid: 42,
  discussion_id: discussionId,
  author: "reviewer",
  body: `comment ${id}`,
  file_path: "src/a.ts",
  line: 2,
  status: "open",
  resolved_by: null,
  raw,
  created_at: "2026-11-04T09:00:00.000Z",
  updated_at: "2026-11-04T09:00:00.000Z",
});

const EMPTY_LEDGER: ResolveEffectLedger = { replies: [], resolvedDiscussions: [] };

const seedFlow = (flowId: string) => {
  const taskId = `task_${flowId}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "generic", `TST-${flowId}`, "resolve effects test", "open", "task", "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    flowId, taskId, "resolve effects test", "active", now(), now(),
  );
  const nodeId = `node_${flowId}`;
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    nodeId, flowId, "resolve", "resolve", "running", now(), now(),
  );
  return nodeId;
};

// ── pure decision matrix (§3) ────────────────────────────────────────────────

describe("planResolveEffects — pure decision matrix", () => {
  const fixed = (id: string, reply?: string) =>
    decision(id, RESOLVE_COMMENT_ACTION.FIXED, reply ? { reply } : {});

  it("plans reply-before-resolve for a fixed decision, even when another decision replies later", () => {
    const shared = "d_multi";
    const plan = planResolveEffects({
      response: response(
        fixed("gl_1", "renamed it"),
        fixed("gl_2", "also touched the same thread"),
      ),
      open: [row("gl_1", shared), row("gl_2", shared)],
      pushState: PUSH_STATE.PUSHED,
    });
    // every reply precedes the (deduped) resolve of the thread
    expect(plan.effects.map((e) => e.kind)).toEqual(["reply", "reply", "resolve"]);
    expect(plan.warnings).toEqual([]);
  });

  it("dedupes same-discussion resolves to one host call and marks every row (G9)", () => {
    const shared = "d_multi";
    const plan = planResolveEffects({
      response: response(fixed("gl_1"), fixed("gl_2")),
      open: [row("gl_1", shared), row("gl_2", shared)],
      pushState: PUSH_STATE.PUSHED,
    });
    expect(plan.effects).toEqual([{ kind: "resolve", threadId: shared, rowIds: ["gl_1", "gl_2"] }]);
  });

  it("never host-calls non-resolvable threads; threadless notes close as local singletons (G8)", () => {
    const plan = planResolveEffects({
      response: response(
        fixed("gl_1"), // discussion, but raw says resolvable:false
        fixed("gl_2", "it was already in abc123"), // no discussion id at all
        decision("gl_3", RESOLVE_COMMENT_ACTION.ANSWERED, {
          reply: "two clients, one per surface",
          resolve: false,
        }),
      ),
      open: [
        row("gl_1", "d_1", JSON.stringify({ resolvable: false })),
        row("gl_2", null),
        row("gl_3", null),
      ],
      pushState: PUSH_STATE.PUSHED,
    });
    expect(plan.effects).toEqual([
      { kind: "localClose", rowIds: ["gl_1"], commentId: "gl_1" },
      { kind: "localClose", rowIds: ["gl_2"], commentId: "gl_2" },
    ]);
    expect(plan.warnings.some((w) => w.includes("no discussion thread"))).toBe(true);
    expect(plan.degradedSkips).toEqual([]);
  });

  it("gates closures on push authority (D1a): local_only/unknown hold, none without reply degrades", () => {
    const open = [row("gl_1")];

    for (const pushState of [PUSH_STATE.LOCAL_ONLY, PUSH_STATE.UNKNOWN]) {
      const plan = planResolveEffects({ response: response(fixed("gl_1", "it moved")), open, pushState });
      // the reply still posts; the thread never closes, and nothing degrades
      expect(plan.effects).toEqual([{ kind: "reply", threadId: "d_gl_1", body: "**AI Resolve**\n\nit moved", commentId: "gl_1" }]);
      expect(plan.degradedSkips).toEqual([]);
      expect(plan.warnings.join("\n")).toMatch(/stays open/);
    }

    const noReply = planResolveEffects({ response: response(fixed("gl_1")), open, pushState: PUSH_STATE.NONE });
    expect(noReply.effects).toEqual([]);
    expect(noReply.degradedSkips).toHaveLength(1);
    expect(noReply.warnings.join("\n")).toMatch(/declared fixed without a reply/);

    // none + a reply: the agent took explicit, explained responsibility
    const noneWithReply = planResolveEffects({
      response: response(fixed("gl_1", "already landed in abc123")),
      open,
      pushState: PUSH_STATE.NONE,
    });
    expect(noneWithReply.effects).toEqual([
      { kind: "reply", threadId: "d_gl_1", body: "**AI Resolve**\n\nalready landed in abc123", commentId: "gl_1" },
      { kind: "resolve", threadId: "d_gl_1", rowIds: ["gl_1"] },
    ]);
    expect(noneWithReply.warnings.join("\n")).toMatch(/resolved without a pushed fix/);

    // answered/wontfix default: the reviewer closes the thread
    const answered = planResolveEffects({
      response: response(decision("gl_1", RESOLVE_COMMENT_ACTION.ANSWERED, { reply: "because X", resolve: false })),
      open,
      pushState: PUSH_STATE.PUSHED,
    });
    expect(answered.effects).toEqual([{ kind: "reply", threadId: "d_gl_1", body: "**AI Resolve**\n\nbecause X", commentId: "gl_1" }]);

    const skipped = planResolveEffects({
      response: response(decision("gl_1", RESOLVE_COMMENT_ACTION.SKIPPED, { resolve: false, note: "out of scope" })),
      open,
      pushState: PUSH_STATE.PUSHED,
    });
    expect(skipped.effects).toEqual([]);
  });
});

// ── scripted fake host ────────────────────────────────────────────────────────

type HostCall = { op: "reply" | "resolve"; threadId: string; body?: string; noteId?: string };

/**
 * FIFO failure queues per op, after which every op succeeds. Records the
 * ordered call log and hands out `gl_`-prefixed note ids — the scheme
 * `mapDiscussion` and `recordAgentReply` dedupe on.
 */
class FakeHostService {
  calls: HostCall[] = [];
  private notes = 900;
  private failures = new Map<string, (() => Error)[]>();

  failOn(op: HostCall["op"], ...makeErrors: (() => Error)[]): this {
    this.failures.set(op, [...makeErrors, ...(this.failures.get(op) ?? [])]);
    return this;
  }

  private take(op: string): Error | null {
    const factory = (this.failures.get(op) ?? []).shift();
    return factory ? factory() : null;
  }

  replyToComment(_repoUrl: string, _cr: number, threadId: string, body: string): Promise<{ id: string; author: string; createdAt: string }> {
    this.calls.push({ op: "reply", threadId, body });
    const failure = this.take("reply");
    if (failure) return Promise.reject(failure);
    const noteId = `gl_note_${++this.notes}`;
    this.calls[this.calls.length - 1].noteId = noteId;
    return Promise.resolve({ id: noteId, author: "ai-bot", createdAt: now() });
  }

  resolveComment(_repoUrl: string, _cr: number, threadId: string): Promise<unknown> {
    this.calls.push({ op: "resolve", threadId });
    const failure = this.take("resolve");
    if (failure) return Promise.reject(failure);
    return Promise.resolve({});
  }
}

const hostOf = (service: FakeHostService): GitHostResolver =>
  ({ forRepo: () => service }) as unknown as GitHostResolver;

const eventsByType = (flowId: string, type: string) =>
  db.all<{ type: string; message: string }>(
    `SELECT type, message FROM events WHERE flow_id=? AND type=? ORDER BY created_at ASC`,
    flowId,
    type,
  );

// ── application ──────────────────────────────────────────────────────────────

describe("ResolveEffects.apply — host effects with retry + ledger", () => {
  const flowId = "flw_resolve_effects";
  const nodeId = seedFlow(flowId);
  const support = new NodeSupport();
  const repoUrl = "https://gitlab.company.com/group/repo.git";

  const seedComment = (
    id: string,
    { discussionId, raw, createdAt = now() }: { discussionId?: string | null; raw?: string; createdAt?: string } = {},
  ) => {
    // an explicit null must seed a threadless row (the ?? default only covers an omitted key)
    const thread = discussionId === undefined ? `d_${id}` : discussionId;
    db.run(
      `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, raw, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, flowId, 42, thread, "reviewer", `comment ${id}`, "src/a.ts", 2,
      "open", raw ?? null, createdAt, now(),
    );
  };

  const commentRows = () =>
    db.all<CommentRow>(
      `SELECT * FROM comments WHERE flow_id=? AND status='open' ORDER BY created_at ASC, id ASC`,
      flowId,
    );

  const input = (over: Pick<ResolveEffectInput, "response" | "open" | "pushState"> & Partial<ResolveEffectInput>): ResolveEffectInput => ({
    flowId,
    nodeId,
    repoUrl,
    mrIid: 42,
    ledger: EMPTY_LEDGER,
    persistProgress: () => {},
    ...over,
  });

  it("fixed + resolve + pushed: reply posts first, then the host resolve closes the thread", async () => {
    const host = new FakeHostService();
    const effects = new ResolveEffects(support, hostOf(host), async () => {});
    seedComment("gl_a");

    const result = await effects.apply(input({ response: response(decision("gl_a", RESOLVE_COMMENT_ACTION.FIXED, { reply: "renamed badlyNamedValue" })), open: commentRows(), pushState: PUSH_STATE.PUSHED }));

    expect(host.calls.map((c) => c.op)).toEqual(["reply", "resolve"]);
    expect(host.calls[0].body).toBe("**AI Resolve**\n\nrenamed badlyNamedValue");
    const noteId = host.calls[0].noteId;
    if (!noteId) throw new Error("expected the reply to return a note id");
    // G10: the posted reply is locally closed before the poller can re-deliver it
    expect(db.get<{ status: string; resolved_by: string }>(
      `SELECT status, resolved_by FROM comments WHERE id=?`,
      noteId,
    )).toEqual({ status: "resolved", resolved_by: "agent" });
    expect(result).toMatchObject({ resolved: 1, replied: 1, wontfix: 0, skipped: 0, hostFailures: 0 });
    expect(db.get<{ status: string }>(`SELECT status FROM comments WHERE id='gl_a'`)).toEqual({ status: "resolved" });
  });

  it("local-only closes for non-resolvable rows: nothing host-called, never a failure (G8)", async () => {
    const host = new FakeHostService();
    const effects = new ResolveEffects(support, hostOf(host), async () => {});
    seedComment("gl_b", { raw: JSON.stringify({ resolvable: false }) });
    seedComment("gl_c", { discussionId: null });
    seedComment("gl_d", { discussionId: null });

    const result = await effects.apply(input({
      response: response(
        decision("gl_b", RESOLVE_COMMENT_ACTION.FIXED),
        decision("gl_c", RESOLVE_COMMENT_ACTION.FIXED),
        decision("gl_d", RESOLVE_COMMENT_ACTION.ANSWERED, { reply: "because two surfaces", resolve: false }),
      ),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
    }));

    expect(host.calls).toEqual([]);
    expect(result.resolved).toBe(2);
    expect(result.hostFailures).toBe(0);
    expect(db.get<{ status: string }>(`SELECT status FROM comments WHERE id='gl_c'`)).toEqual({ status: "resolved" });
    // the reply could not be posted (no thread) and the notes stay open (G11 marker path)
    expect(db.get<{ status: string }>(`SELECT status FROM comments WHERE id='gl_d'`)).toEqual({ status: "open" });
    expect(eventsByType(flowId, "log").some((e) => e.message.includes("no discussion thread"))).toBe(true);
  });

  it("pushed=false-like states hold threads open: local_only replies post, nothing resolves, no failure (§6A)", async () => {
    const host = new FakeHostService();
    const effects = new ResolveEffects(support, hostOf(host), async () => {});
    seedComment("gl_e");

    const result = await effects.apply(input({
      response: response(decision("gl_e", RESOLVE_COMMENT_ACTION.FIXED, { reply: "renamed the variable" })),
      open: commentRows(),
      pushState: PUSH_STATE.LOCAL_ONLY,
    }));

    expect(host.calls.map((c) => c.op)).toEqual(["reply"]);
    expect(result.replied).toBe(1);
    expect(result.resolved).toBe(0);
    expect(result.hostFailures).toBe(0);
    expect(db.get<{ status: string }>(`SELECT status FROM comments WHERE id='gl_e'`)).toEqual({ status: "open" });
    expect(eventsByType(flowId, "log").some((e) => e.message.includes("not pushed"))).toBe(true);
  });

  it("429s retry with honored retryAfterMs and recover mid-effect", async () => {
    const host = new FakeHostService();
    host.failOn("resolve", () => new GitHostApiError("rate limited", "/notes", 429, 2500));
    const delays: number[] = [];
    const effects = new ResolveEffects(support, hostOf(host), async (ms) => { delays.push(ms); });
    seedComment("gl_f");

    const result = await effects.apply(input({
      response: response(decision("gl_f", RESOLVE_COMMENT_ACTION.FIXED)),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
    }));

    expect(host.calls.filter((c) => c.op === "resolve")).toHaveLength(2);
    expect(delays).toEqual([2500]);
    expect(result.resolved).toBe(1);
    expect(result.hostFailures).toBe(0);
    expect(db.get<{ status: string }>(`SELECT status FROM comments WHERE id='gl_f'`)).toEqual({ status: "resolved" });
  });

  it("exhausted 429 retries count one hostFailure and leave the thread open", async () => {
    const host = new FakeHostService();
    host.failOn("resolve",
      () => new GitHostApiError("rate limited", "/notes", 429),
      () => new GitHostApiError("still rate limited", "/notes", 429),
      () => new GitHostApiError("still rate limited", "/notes", 429),
    );
    const delays: number[] = [];
    const effects = new ResolveEffects(support, hostOf(host), async (ms) => { delays.push(ms); });
    seedComment("gl_g");

    const result = await effects.apply(input({
      response: response(decision("gl_g", RESOLVE_COMMENT_ACTION.FIXED)),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
    }));

    expect(host.calls.filter((c) => c.op === "resolve")).toHaveLength(3); // initial + 2 bounded retries
    expect(delays).toEqual([1000, 2000]); // backoff min(1s·2ⁿ, 8s)
    expect(result.hostFailures).toBe(1);
    expect(db.get<{ status: string }>(`SELECT status FROM comments WHERE id='gl_g'`)).toEqual({ status: "open" });
    expect(eventsByType(flowId, "error").some((e) => e.message.includes("could not resolve MR thread"))).toBe(true);
  });

  it("404 is permanent — no retry, one call, one failure", async () => {
    const host = new FakeHostService();
    host.failOn("reply", () => new GitHostApiError("not found", "/notes", 404));
    const effects = new ResolveEffects(support, hostOf(host), async () => {});
    seedComment("gl_h");

    const result = await effects.apply(input({
      response: response(decision("gl_h", RESOLVE_COMMENT_ACTION.WONTFIX, { reply: "won't change", resolve: false })),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
    }));

    expect(host.calls).toHaveLength(1);
    expect(eventsByType(flowId, "error").some((e) => e.message.includes("could not post reply"))).toBe(true);
    expect(result.hostFailures).toBe(1);
    expect(result.wontfix).toBe(1);
  });

  it("re-application skips ledgered effects and only counts the new ones (§4 recovery)", async () => {
    const host = new FakeHostService();
    const effects = new ResolveEffects(support, hostOf(host), async () => {});
    seedComment("gl_i");
    seedComment("gl_j", { discussionId: "d_j" });

    const first = await effects.apply(input({
      response: response(
        decision("gl_i", RESOLVE_COMMENT_ACTION.FIXED, { reply: "did it" }),
        decision("gl_j", RESOLVE_COMMENT_ACTION.FIXED),
      ),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
    }));
    const callsAfterFirst = host.calls.length;
    expect(first.ledger.replies).toHaveLength(1);
    expect(first.ledger.resolvedDiscussions).toEqual(["d_gl_i", "d_j"]);

    // recovery re-presents the already-closed rows and re-applies the same
    // response with the recorded ledger: nothing is host-called twice
    const second = await effects.apply(input({
      response: response(
        decision("gl_i", RESOLVE_COMMENT_ACTION.FIXED, { reply: "did it" }),
        decision("gl_j", RESOLVE_COMMENT_ACTION.FIXED),
      ),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
      ledger: first.ledger,
    }));

    expect(host.calls.length).toBe(callsAfterFirst);
    expect(second.replied).toBe(0);
    expect(second.resolved).toBe(0);
  });

  it("persistProgress runs after every landed effect and journals the ledger into the artifact meta", async () => {
    const host = new FakeHostService();
    const effects = new ResolveEffects(support, hostOf(host), async () => {});
    seedComment("gl_k");

    let saves = 0;
    await effects.apply(input({
      response: response(decision("gl_k", RESOLVE_COMMENT_ACTION.FIXED, { reply: "fixed in place" })),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
      persistProgress: (ledger) => {
        saves += 1;
        support.saveArtifact(nodeId, flowId, "resolve", "summary", { ledger });
      },
    }));

    // one persist per landed effect: reply, then host resolve
    expect(saves).toBe(2);
    const versions = db.all<{ version: number; meta: string | null }>(
      `SELECT version, meta FROM artifacts WHERE node_id=? AND kind='resolve' ORDER BY version`,
      nodeId,
    );
    expect(versions).toHaveLength(2);
    expect(JSON.parse(versions[1].meta ?? "{}").ledger.resolvedDiscussions).toEqual(["d_gl_k"]);
  });

  it("one failing effect never stops the rest of the plan (§4)", async () => {
    const host = new FakeHostService();
    host.failOn("resolve", () => new GitHostApiError("not found", "/notes", 404)); // permanent for the first thread
    const effects = new ResolveEffects(support, hostOf(host), async () => {});
    seedComment("gl_l", { discussionId: "d_l" });
    seedComment("gl_m", { discussionId: "d_m" });

    const result = await effects.apply(input({
      response: response(
        decision("gl_l", RESOLVE_COMMENT_ACTION.FIXED),
        decision("gl_m", RESOLVE_COMMENT_ACTION.FIXED),
      ),
      open: commentRows(),
      pushState: PUSH_STATE.PUSHED,
    }));

    expect(result.hostFailures).toBe(1);
    expect(result.resolved).toBe(1); // gl_m's thread still closed
    expect(db.get<{ status: string }>(`SELECT status FROM comments WHERE id='gl_m'`)).toEqual({ status: "resolved" });
  });
});
