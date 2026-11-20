import "server-only";

import { db } from "../../db/app";
import { RunSupersededError } from "../errors/runSupersededError";
import type { EngineParts } from "../../composition/container";

/**
 * BgRunner — the engine's fire-and-forget runner for stage/step background
 * work: an error emits the typed event, fails the node through the
 * authority's declared `stageError` transition (`failFromRunning`), and
 * clears the attempt registry in the `finally` — the failure never propagates
 * to the caller that scheduled the work.
 *
 * Invariants: a superseded run is swallowed silently (the winner of the race
 * already owns the node); the attempt token is cleared against the node's
 * CURRENT attempt_id (a retry that re-claimed mid-flight keeps its token).
 *
 * Must never: run work inline (always fire-and-forget), or swallow a
 * non-superseded error without the event + terminal fail.
 */
export class BgRunner {
  constructor(
    private readonly parts: EngineParts,
    private readonly touch: (flowId: string) => Promise<void>,
  ) {}

  run(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
    void (async () => {
      try {
        await fn();
      } catch (e: unknown) {
        if (e instanceof RunSupersededError) return;
        const msg = e instanceof Error ? e.message : String(e);
        await this.parts.events.error(flowId, nodeKey, msg, { nodeKey });
        if (nodeKey) {
          await this.parts.transitions.failFromRunning(flowId, nodeKey);
        }
      } finally {
        if (nodeKey) {
          const nodeId = await this.parts.nodeStore.idOf(flowId, nodeKey);
          if (nodeId) {
            const attemptId = (
              await db.get<{ attemptId: string | null }>(
                `SELECT attempt_id AS "attemptId" FROM nodes WHERE id=$1`,
                nodeId,
              )
            )?.attemptId;
            this.parts.attemptRegistry.clear(nodeId, attemptId);
          }
        }
        await this.touch(flowId);
      }
    })();
  }
}
