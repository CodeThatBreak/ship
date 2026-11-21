import "server-only";

import { DiffStalenessProbe } from "./diffStalenessProbe";

/**
 * Process pin for the diff-fact staleness probe (decision Q9 — the runContext
 * pin pattern): the class file stays pure, the instance is pinned here.
 * Stateless — the probe only reads.
 */
export const diffStaleness = new DiffStalenessProbe();