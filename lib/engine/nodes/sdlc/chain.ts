import { db } from "../../../db";
import { NodeRow, rows } from "../../../db/rows";
import type { FlowCtx } from "../base";
import { configNumber, appLayerConfig, mergeConfigLayers } from "../../node-config";
import { templateStore } from "../../templates";
import { branchStore } from "../build";
import { isCommitError, mergeRequests, type CommitError } from "../merge-request";

/**
 * The engine surface the SDLC chain drives — the generic orchestration
 * primitives flow.ts owns (node runs, status/current-pointer wiring, edge
 * activation). The chain module is the one builtin family allowed to call
 * them; nothing outside lib/engine touches these.
 */
export interface ChainHost {
  ctx(flowId: string): FlowCtx;
  /** fire-and-forget run wrapper (marks the node failed on error) */
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  setCurrentNode(flowId: string, nodeKey: string | null): void;
  setNodeStatus(flowId: string, nodeKey: string, status: string): void;
  clearCurrentIf(flowId: string, nodeKey: string): void;
  nodeStatus(flowId: string, nodeKey: string): string;
  nodeRunning(flowId: string, nodeKey: string): boolean;
  /** full config layer stack for a node instance (class ← app ← flow snapshot) */
  nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown>;
  /** the per-flow instance config layer for one node (nodes.config snapshot) */
  flowNodeConfig(flowId: string, nodeKey: string): Record<string, unknown>;
  firstKeyOfType(flowId: string, defKey: string): string | null;
  /** the CI gate node (waits on the pipeline source) */
  gateKey(flowId: string): string | null;
  /** resolve a node's outgoing `next` edges and start what becomes eligible */
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
  /** true while any post-MR chain stage (pipeline/review/resolve) is running */
  chainBusy(flowId: string): boolean;
  /** the armed wait-timer deadline for a (flow, node), epoch ms — null when none */
  waitTimerDueAt(flowId: string, nodeKey: string): number | null;
}

/** Distinguishes MR-creation failures from later pipeline/review failures. */
export class MrCreationFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MrCreationFailed";
  }
}

/**
 * The SDLC builtin chain (pristine plan §2.1): the gate → review → resolve →
 * re-gate loop, the MR-creation-with-commit-fix retry, the quiet-period
 * resolve scheduler, and the five built-ins' flow actions that drive them.
 *
 * Extracted verbatim from flow.ts as a "builtin chain" module — flow.ts keeps
 * the generic graph mechanics and delegates these entries here. The module is
 * the only engine member (besides the node classes) that knows the chain's
 * shape; when the loop moves fully into template edges, this file is where the
 * remaining action handlers live.
 */
export class SdlcChain {
  constructor(private readonly host: ChainHost) {}

  approveBuild(flowId: string, branchName?: string): void {
    const buildKey = this.host.firstKeyOfType(flowId, "build");
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    this.host.setNodeStatus(flowId, buildKey, "approved");
    this.host.setCurrentNode(flowId, gate);
    this.host.bg(flowId, null, async () => {
      try {
        if (branchName) {
          await this.createMrAndGate(flowId, branchName);
        } else {
          const branches = branchStore.list(flowId).filter((b) => b.status === "awaiting_approval" || b.status === "approved");
          if (branches.length > 1) {
            for (const b of branches) await this.createMrAndGate(flowId, b.name);
          } else {
            await this.createMrAndGate(flowId, null);
          }
        }
        this.host.setCurrentNode(flowId, null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof MrCreationFailed) {
          // MR creation failed (infra, or commit-fix attempts exhausted): hand the
          // step back to the developer — the "Approve & create MR" button reappears
          // and clicking it retries MR creation with the current branch state.
          db.emitEvent(flowId, null, "mr_failed",
            `MR creation failed: ${msg} — fix the issue, then click "Approve & create MR" again to retry`,
            { branchName });
          this.host.setNodeStatus(flowId, buildKey, "awaiting_approval");
        } else {
          // pipeline gate / review failures: those nodes already carry their own
          // failed status + Retry — just surface the error.
          db.emitEvent(flowId, null, "error", msg);
        }
        this.host.setCurrentNode(flowId, null);
      }
    });
  }

  /**
   * MR creation → pipeline gate → review, for one branch (or the single-branch
   * flow). Each stage must succeed before the next starts:
   *  - MR creation failures from rejected pushes (hooks/type checks) are fixed
   *    by a commit-fix agent inside the build step and retried (bounded);
   *    infra failures (network/auth) surface to the user for manual retry.
   *  - the pipeline gate waits for a green pipeline, fixing failures itself.
   */
  private async createMrAndGate(flowId: string, branchName: string | null): Promise<void> {
    try {
      await this.createMrWithFixes(flowId, branchName);
    } catch (e: unknown) {
      throw new MrCreationFailed(e instanceof Error ? e.message : String(e));
    }
    await this.runGateChain(flowId, branchName);
  }

  /**
   * The single post-pipeline chain — the ONLY place the flow advances past the
   * CI gate. Every path that waits on the pipeline (build approval, the
   * Pipeline panel button, retry, and the resolve re-gate) funnels through
   * here, so the sequence is always:
   *
   *   pipeline gate (green) → review → resolve (only while open comments
   *   remain) → re-gate → review → …
   *
   * The whole chain runs inline in the caller's background task — no nested
   * fire-and-forget spawns — so the current-node pointer and the node guards
   * always reflect the one run that's actually in flight, and resolve never
   * runs twice for the same batch of comments. Multi-branch flows stop after
   * the gate (review/resolve run per branch from their own triggers).
   *
   * The node keys come from the flow's template graph (roles: the CI gate,
   * its auto-flowing successor, its debounced successor); the inline gate→
   * review→resolve→re-gate loop carries the loop's conditions until edge
   * conditions arrive with the Phase 3 decision/JSONata work.
   */
  async runGateChain(
    flowId: string,
    branchName: string | null,
    opts: {
      resolveLoop?: boolean;
      pipelineId?: number | null;
      prompt?: string | null;
      promptIsBody?: boolean;
      model?: string | null;
    } = {},
  ): Promise<void> {
    const host = this.host;
    const gate = host.gateKey(flowId);
    const graph = templateStore.graphForFlow(flowId);
    const chain = templateStore.chainNodeKeys(flowId);
    const reviewKey = chain[1] ?? host.firstKeyOfType(flowId, "review");
    // the resolve role = the debounced successor of the gate chain (SDLC's
    // resolve). Custom templates without a debounced node end the chain after
    // review — their downstream auto nodes advance via the template edges.
    const resolveKey = chain.find((k) => graph?.byKey.get(k)?.trigger.type === "debounced") ?? null;
    if (!gate) throw new Error("this flow template has no pipeline gate node");

    // the resolve node's max_regate_loops knob bounds the re-gate loop
    // (0/absent = unlimited, today's behavior)
    const maxRegateLoops = resolveKey
      ? configNumber(host.nodeConfigFor(flowId, resolveKey), "max_regate_loops", 0)
      : 0;

    // first pass: resolve runs only when the scheduler had one due (comments
    // arrived mid-gate and the quiet period elapsed) — or immediately when the
    // caller just resolved code (resolveLoop). After a resolve run we re-gate,
    // and loop back into resolve whenever comments are still open.
    let inResolveLoop = opts.resolveLoop ?? false;
    let regates = 0;
    // a specific watched pipeline / prompt / model applies to the chain's
    // first gate only — later gates re-read the MR head with defaults
    let gateInput: Record<string, unknown> | null = opts.pipelineId != null || opts.prompt != null || opts.model != null
      ? {
          pipelineId: opts.pipelineId ?? null,
          prompt: opts.prompt ?? null,
          promptIsBody: opts.promptIsBody ?? false,
          model: opts.model ?? null,
        }
      : null;
    for (;;) {
      host.setCurrentNode(flowId, gate);
      await host.runNode(flowId, gate, {
        branchName, pipelineId: null, guidance: null, prompt: null, promptIsBody: false, model: null,
        ...(gateInput ?? {}),
      });
      gateInput = null;

      // gate green → review (single-branch flows only; multi-branch reviews run
      // per-branch from the branch's own approval). After review, its template
      // `next` edges activate — the SDLC resolve (debounced) doesn't auto-start,
      // custom auto successors do (Phase 2 templates).
      if (!branchName && reviewKey) {
        host.setCurrentNode(flowId, reviewKey);
        await host.runNode(flowId, reviewKey, {
          instructions: null, prompt: null, promptIsBody: false, branchName: null, model: null,
        });
        await host.advanceFrom(flowId, reviewKey);
      }

      // the resolve loop is flow-level (single-MR); multi-branch flows resolve
      // per branch from their own triggers
      if (branchName || !resolveKey) return;
      const open = db.get<{ c: number }>(
        `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, flowId)?.c ?? 0;
      const due = this.resolveDue.get(flowId);
      this.resolveDue.delete(flowId);
      const scheduledDue = due != null && Date.now() >= due;
      if (open === 0 || (!inResolveLoop && !scheduledDue)) return;

      host.setCurrentNode(flowId, resolveKey);
      db.emitEvent(flowId, null, "lifecycle", `resolving ${open} open comment(s)`);
      await host.runNode(flowId, resolveKey, {
        instructions: null, prompt: null, promptIsBody: false, branchName: null, model: null,
      });
      // only loop when the resolve agent actually pushed code changes — a
      // fix run that touched nothing makes re-gate + re-review a no-op
      if (!this.resolveChangedCode(flowId, resolveKey)) return;
      if (maxRegateLoops > 0 && regates >= maxRegateLoops) {
        db.emitEvent(flowId, null, "lifecycle",
          `re-gate loop limit reached (${maxRegateLoops}) — the flow stays open for manual follow-up`);
        return;
      }
      regates++;
      inResolveLoop = true; // code changed → loop: re-gate → review → resolve-if-open
    }
  }

  /**
   * Create the MR, running a commit-fix agent on the build node when the push
   * was rejected (pre-push/pre-receive hooks — e.g. type checks). Throws the
   * original error after MAX attempts, or immediately for infra failures.
   * The attempt budget comes from the build node's `max_commit_fix_attempts`
   * knob (default = today's constant, 2).
   */
  async createMrWithFixes(flowId: string, branchName: string | null): Promise<void> {
    const host = this.host;
    const buildKey = host.firstKeyOfType(flowId, "build");
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = host.gateKey(flowId);
    const MAX_FIX_ATTEMPTS = configNumber(
      host.nodeConfigFor(flowId, buildKey), "max_commit_fix_attempts", 2);
    for (let attempt = 0; ; attempt++) {
      try {
        await mergeRequests.create(host.ctx(flowId), branchName ?? undefined);
        return;
      } catch (e: unknown) {
        if (!isCommitError(e) || attempt >= MAX_FIX_ATTEMPTS) throw e;
        db.emitEvent(flowId, null, "lifecycle",
          `push rejected — running a commit-fix agent on the build step (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS})`);
        host.setCurrentNode(flowId, buildKey);
        host.setNodeStatus(flowId, buildKey, "running");
        try {
          await host.runNode(flowId, buildKey, {
            plan: null, prompt: null, branchInfo: null, model: null,
            feedback:
              `Pushing branch was rejected with the error below — most likely a pre-push/pre-receive hook ` +
              `(type check, lint, or test gate). Fix the code so the checks pass, commit, and push again to the same branch.\n\n` +
              `${(e as CommitError).detail}`,
          });
        } finally {
          host.setNodeStatus(flowId, buildKey, "approved");
          // hand the pointer back to the gate the chain will enter next
          host.setCurrentNode(flowId, gate);
        }
      }
    }
  }

  // true when the latest resolve run actually pushed code changes to the MR
  // branch — the review re-trigger is gated on this, not on the comment count
  // (a resolve agent that only explained why comments were wrong resolves them
  // but must not kick off another pipeline/review pass)
  resolveChangedCode(flowId: string, resolveKey: string): boolean {
    const out = rows.get(NodeRow,
      `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, resolveKey)?.output;
    return (out as { codeChanged?: boolean } | null)?.codeChanged === true;
  }

  // ── resolve scheduling (quiet-period debounce + pipeline gate) ───────────
  //
  // MR comments never start the resolve node directly: every ingest path
  // (webhook / poller) schedules a run. The poller's tick fires the schedule
  // once BOTH conditions hold:
  //   1. the pipeline node is not running or pending — resolve must wait for
  //      the pipeline step to pass first (a `failed` pipeline doesn't block:
  //      it's terminal until retried, and the resolve → re-gate loop covers it)
  //   2. no new open comment arrived within the quiet period — so reviewers
  //      adding several comments in a row get one resolve run for all of them

  /** Per-flow in-memory schedule state: "fire no earlier than". */
  private resolveDue = new Map<string, number>();

  /**
   * When the currently queued resolve run would start (epoch ms) — the quiet
   * period has to elapse first, then the pipeline gate must be clear. The
   * Resolve panel shows this as the scheduled start time. Null when nothing
   * is queued.
   */
  resolveScheduleAt(flowId: string): number | null {
    return this.resolveDue.get(flowId) ?? null;
  }

  /** The queued resolve's start time as wall-clock text ("14:32"), or null. */
  resolveScheduleClock(flowId: string): string | null {
    const at = this.resolveDue.get(flowId);
    if (at == null) return null;
    return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  /** How long after the last new open comment the resolve may start.
   *  Per flow: the flow's resolve node `quiet_minutes` knob (class default 10,
   *  app settings overlay the legacy `resolve.delay_ms` / RESOLVE_DELAY_MINUTES
   *  aliases so existing setups behave exactly as before). Flows without a
   *  resolve node instance fall back to the app-settings layer alone. */
  resolveDelayMs(flowId?: string): number {
    const resolveKey = flowId ? this.host.firstKeyOfType(flowId, "resolve") : null;
    const cfg = mergeConfigLayers(
      appLayerConfig("resolve"),
      resolveKey ? this.host.flowNodeConfig(flowId!, resolveKey) : {},
    );
    return configNumber(cfg, "quiet_minutes", 10) * 60_000;
  }

  /**
   * Queue a resolve run for `flowId`, resetting the quiet period (each new
   * comment pushes the earliest start out by resolveDelayMs()). The flow's
   * poller tick fires the schedule — a no-op when the flow has no MR yet.
   */
  scheduleResolve(flowId: string): void {
    this.resolveDue.set(flowId, Date.now() + this.resolveDelayMs(flowId));
  }

  private pipelineGateBusy(flowId: string): boolean {
    const gate = this.host.gateKey(flowId);
    if (!gate) return false;
    const s = this.host.nodeStatus(flowId, gate);
    return s === "running" || s === "pending";
  }

  /**
   * Fire scheduled resolves whose quiet period elapsed and whose pipeline
   * gate is clear. Called from the poller tick; emits one event per state
   * change so the activity feed explains what resolve is waiting for.
   */
  processResolveSchedules(): void {
    const now = Date.now();
    for (const [flowId, due] of [...this.resolveDue]) {
      if (now < due) continue; // quiet period still running
      this.fireScheduledResolve(flowId);
    }
  }

  /**
   * Fire a flow's scheduled resolve now when it's due and nothing blocks it.
   * Used both by the poller tick and by the post-pipeline chain — after a
   * green gate + review, a resolve that was queued mid-gate fires immediately
   * instead of waiting for the next poll.
   */
  private fireScheduledResolve(flowId: string): void {
    const due = this.resolveDue.get(flowId);
    if (due == null || Date.now() < due) return; // nothing scheduled / still quiet
    // a chain is in flight → it ends with a resolve-if-open check, so the
    // schedule stays queued and gets picked up by that chain (or the next tick)
    if (this.host.chainBusy(flowId)) return;
    if (this.pipelineGateBusy(flowId)) return; // re-checked on the next tick
    const open = db.get<{ c: number }>(
      `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, flowId)?.c ?? 0;
    this.resolveDue.delete(flowId);
    if (open > 0) {
      this.triggerResolve(flowId, undefined, undefined, undefined, { scheduled: true });
    }
  }

  /** (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook. */
  triggerPipelineGate(flowId: string, pipelineId?: number, prompt?: string, model?: string, promptIsBody?: boolean): void {
    if (this.host.chainBusy(flowId)) return;
    const gate = this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    this.host.setCurrentNode(flowId, gate);
    this.host.bg(flowId, gate, async () => {
      try {
        // always the full chain — a green gate flows on to review (and a
        // resolve when comments are waiting), never leaves the flow stranded
        await this.runGateChain(flowId, null, {
          pipelineId: pipelineId ?? null, prompt: prompt ?? null,
          promptIsBody: promptIsBody ?? false, model: model ?? null,
        });
      } finally {
        this.host.setCurrentNode(flowId, null);
      }
    });
  }

  triggerResolve(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean, opts: { scheduled?: boolean } = {}): void {
    const resolveKey = this.host.firstKeyOfType(flowId, "resolve");
    if (!resolveKey) return;
    if (this.host.nodeRunning(flowId, resolveKey)) return;
    // Direct triggers (Run button / API) respect the chain — resolve must not
    // run while the pipeline/review/resolve chain is in flight. `scheduled` is
    // the internal bypass for runs the scheduler already gated.
    if (!opts.scheduled && this.host.chainBusy(flowId)) {
      throw new Error("wait for the pipeline/review step to finish before running resolve");
    }
    this.host.setCurrentNode(flowId, resolveKey);
    this.host.bg(flowId, resolveKey, async () => {
      try {
        await this.host.runNode(flowId, resolveKey, {
          instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
        });
        // re-enter the unified chain in resolve-loop mode (pipeline gate →
        // review → resolve while open comments remain) — but only when the
        // resolve agent actually pushed code changes; a run that touched
        // nothing makes re-gate + re-review a no-op. Everything runs inline in
        // this task, so resolve can never double-run for the same batch.
        if (this.resolveChangedCode(flowId, resolveKey)) {
          await this.runGateChain(flowId, null, { resolveLoop: true });
        }
      } finally {
        this.host.setCurrentNode(flowId, null);
      }
    });
  }

  triggerReview(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    const reviewKey = this.host.firstKeyOfType(flowId, "review");
    if (!reviewKey) throw new Error("this flow template has no review node");
    if (this.host.chainBusy(flowId)) throw new Error("wait for the current pipeline/review/resolve run to finish first");
    this.host.setCurrentNode(flowId, reviewKey);
    this.host.bg(flowId, reviewKey, () => this.host.runNode(flowId, reviewKey, {
      instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
    }).then(() => this.host.setCurrentNode(flowId, null)));
  }
}

export function createSdlcChain(host: ChainHost): SdlcChain {
  return new SdlcChain(host);
}
