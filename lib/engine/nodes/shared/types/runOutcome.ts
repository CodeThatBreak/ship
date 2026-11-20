import type { NodeRunStatus } from "../../../../../constants/flow";

/**
 * What a node stores in its `output` column when it finishes a run.
 * Each node narrows this with its own schema.
 */
export interface RunOutcome {
  output: Record<string, unknown>;
  /** final node status — the closed set in `NODE_RUN_STATUS` (§2.7) */
  status: NodeRunStatus;
  /** artifact to save (kind + content + meta); nodes may save more themselves */
  artifact?: { kind: string; content: string; meta?: unknown };
  /** lifecycle event message */
  event: string;
  eventData?: Record<string, unknown>;
  /** text returned to chat callers */
  reply: string;
}
