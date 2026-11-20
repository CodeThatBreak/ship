import "server-only";

import { taskRegistry } from "../../../tasks/registry";

/** Task types a template's trigger may declare — the registered provider kinds
 *  (docs/tasks-plan.md §2). A template declares WHICH task type its flows run
 *  on (trigger.taskType); flows receive the concrete task at start time. */
export const TASK_TRIGGER_TYPES = taskRegistry.list().map((p) => p.kind) as string[];
