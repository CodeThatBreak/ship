import "server-only";

import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import { GATE_PROGRESS_ARTIFACT } from "./constants/waiting";
import { GateProgressSchema } from "./schema";
import type { GateProgress } from "./types/gateProgress";

/**
 * GateProgressStore — the pipeline gate's durable wait progress (step 05,
 * Invariant 9): the loop state (`fixes`, `manualPlays`, `lastSeen`, the
 * deadline) persists as `gate_progress` artifact meta, Zod-validated on both
 * write and read, so a restart resumes the wait instead of discarding it.
 *
 * Must never: hand back a fabricated default for unparseable progress — the
 * caller maps that to a `manual` recovery (an empty ledger would re-run fix
 * agents the durable state already budgeted).
 */
export class GateProgressStore {
  constructor(private readonly support: NodeSupport) {}

  /**
   * The persisted progress for one gate node, or null when the node never
   * persisted any (a fresh run). THROWS on a present-but-unparseable blob —
   * the resume path turns that into `{ kind: "manual" }` with the reason.
   */
  async load(ctx: FlowCtx): Promise<GateProgress | null> {
    const art = await this.support.latestArtifact(ctx.flow.id, GATE_PROGRESS_ARTIFACT, { nodeType: NODE_KEYS.PIPELINE });
    if (!art?.meta) return null;
    const parsed = GateProgressSchema.parse(art.meta);
    return {
      watchedId: parsed.watchedId,
      lastSeen: parsed.lastSeen,
      fixedIds: [...parsed.fixedIds],
      triggerAttempted: parsed.triggerAttempted,
      fixWaitStart: parsed.fixWaitStart,
      manualPlays: { ...parsed.manualPlays },
      fixes: parsed.fixes,
      deadlineAt: parsed.deadlineAt,
    };
  }

  /** Persist one progress snapshot (the loop calls this on every state change). */
  async save(ctx: FlowCtx, nodeId: string, progress: GateProgress): Promise<void> {
    await this.support.saveArtifact(
      nodeId,
      ctx.flow.id,
      GATE_PROGRESS_ARTIFACT,
      JSON.stringify(progress),
      GateProgressSchema.parse(progress),
    );
  }
}
