import "server-only";

import { PlanStepStore } from "./planStepStore/planStepStore";

/**
 * Shared plan-step store pin (stateless, db-fenced — decision Q9). The
 * PlanStepStore class lives in `planStepStore/` (its row types in
 * `planStepStore/types/planStep.ts`); this module keeps the pin so the
 * import surface (`planSteps`) is unchanged. Class files are pure
 * (classFilePurity arch test), so the instance is pinned here.
 */
export const planSteps = new PlanStepStore();
