import "server-only";

import type { SplitUnitStatus } from "../types/splitUnitStatus";

/** The consumer's worst-of precedence (decision 4): failed > awaiting_approval > done. */
export const WORST_OF_PRECEDENCE: readonly SplitUnitStatus[] = ["failed", "awaiting_approval", "done"];
