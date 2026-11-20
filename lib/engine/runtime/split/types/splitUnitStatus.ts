import "server-only";

import type { SPLIT_UNIT_STATUSES } from "../constants/splitUnitStatuses";

/** One split unit's derived status (the vocabulary lives in
 *  `constants/splitUnitStatuses.ts`). */
export type SplitUnitStatus = (typeof SPLIT_UNIT_STATUSES)[number];
