import "server-only";

import type { BranchStatus } from "../../../db/constants/rowStatuses";

/**
 * The branch-row status a `branch` fact stamps (Task 06). The design spec
 * names `pushed`, but `BranchStatus` is a sticky Prisma enum without that
 * value and a schema change needs owner approval (AGENTS §1) — until that
 * lands, the fact stamps `building`, the status `buildFinalizer` already
 * writes for "the run created and pushed this branch".
 */
export const BRANCH_FACT_STATUS: BranchStatus = "building";
