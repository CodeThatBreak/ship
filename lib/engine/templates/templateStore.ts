import "server-only";

import { TemplateStore } from "./templateStore/templateStore";

/**
 * Shared application template store — the pin. The TemplateStore class lives
 * in `templateStore/` (its editor-payload types in `templateStore/types/`,
 * its kind vocabularies in `templateStore/constants/`); this module keeps
 * the pin plus the surface's re-exports so every existing consumer keeps
 * its import path. Class files are pure (classFilePurity arch test), so the
 * instance is pinned here.
 */
export const templateStore = new TemplateStore();

/** Seeded built-in template — the SDLC loop (plan → build → pipeline → review → resolve). */
export { SDLC_TEMPLATE_ID } from "../constants/nodeKeys";

/** Trigger vocabularies live in `constants/triggers.ts`; re-exported here so
 *  the TemplateStore module's public surface is unchanged. */
export {
  FLOW_TRIGGER_TYPES,
  NO_TASK_TYPE,
  NODE_TRIGGER_TYPES,
  WAIT_FOR_SOURCES,
} from "../constants/triggers";
/** Task types a template's trigger may declare — the registered provider kinds
 *  (docs/tasks-plan.md §2). A template declares WHICH task type its flows run
 *  on (trigger.taskType); flows receive the concrete task at start time. */
export { TASK_TRIGGER_TYPES } from "./templateStore/constants/taskTriggerTypes";
// Cross-module template types live in `types/template.ts` (engine/types/) —
// re-exported here so every existing consumer keeps its import path.
export type {
  TemplateEdgeInput,
  TemplateEdgeSpec,
  TemplateGraph,
  TemplateInput,
  TemplateNodeInput,
  TemplateNodeSpec,
} from "../types/template";
export type { DraftNodeTemplateInput, TemplateNodeMeta } from "./templateStore/types/templateStore";
