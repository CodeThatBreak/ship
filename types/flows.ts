/**
 * Client-safe flow-list types shared by the server-rendered page and the
 * client island. No `lib/` imports here — this module must stay bundleable.
 */

/** One row of the workspace flow list (engine flow projection, §flow list). */
export type FlowSummary = {
  id: string;
  taskId: string;
  name: string;
  status: string;
  taskKey: string;
  taskSummary: string;
  mrUrl?: string;
  executionMode?: string;
  /** plan fan-out (Phase 4): step-progress summary when a checklist is linked
   *  to step sub-flows (`active` = children still unresolved) */
  fanout?: { steps: number; done: number; active: boolean };
};

/** Worktree git state for one local flow row (GET /api/flows/worktree-status). */
export type WorktreeStatus = {
  path: string;
  registered: boolean;
  branch?: string | null;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  pushed?: boolean;
  stat?: string;
  mrBranch?: string | null;
  reason?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Keep the fanout shape only when it is a real {steps, done} record. */
function fanoutOf(v: unknown): FlowSummary["fanout"] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const f = v as Record<string, unknown>;
  const steps = typeof f.steps === "number" ? f.steps : 0;
  const done = typeof f.done === "number" ? f.done : 0;
  if (steps <= 0 && done <= 0) return undefined;
  return { steps, done, active: done < steps };
}

/** The list row selects the task relation as `{ key, summary }` (Prisma row). */
function taskOf(v: unknown): { key: string; summary: string } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { key: "", summary: "" };
  const t = v as Record<string, unknown>;
  return { key: str(t.key), summary: str(t.summary) };
}

/**
 * Narrow one engine flow row (`flowEngine.list()` returns camelCase Prisma
 * rows) into the typed list row. Unknown fields are dropped; the missing
 * fallbacks mirror the old client-side JSON handling.
 */
export function flowSummary(row: Record<string, unknown>): FlowSummary {
  const task = taskOf(row.task);
  return {
    id: str(row.id),
    taskId: str(row.taskId),
    name: str(row.name),
    status: str(row.status),
    taskKey: task.key,
    taskSummary: task.summary,
    mrUrl: optStr(row.mrUrl),
    executionMode: optStr(row.executionMode),
    fanout: fanoutOf(row.fanout),
  };
}

/** Narrow a list of engine flow rows, dropping rows without an id. */
export function flowSummaries(rows: readonly unknown[] | undefined): FlowSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => flowSummary(r as Record<string, unknown>))
    .filter((f) => f.id);
}
