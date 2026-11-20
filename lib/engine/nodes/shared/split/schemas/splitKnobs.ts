import "server-only";

import { z } from "zod";
import {
  DEFAULT_SPLIT_CONSUME,
  DEFAULT_SPLIT_PARALLEL_MAX,
  SPLIT_CONSUME_MODES,
} from "../../split";

/** Zod fragment for the knob (default = today's behavior). Not yet wired
 *  into any def's `configSchema`/`configFields` — that is Phase 4. */
export const splitConsumeSchema = z.enum(SPLIT_CONSUME_MODES).default(DEFAULT_SPLIT_CONSUME);

/** Zod fragment for the flat `split_parallel_max` knob — wired beside
 *  `splitConsumeSchema` into every split-capable consumer's config schema. */
export const splitParallelMaxSchema = z.number().int().min(1).default(DEFAULT_SPLIT_PARALLEL_MAX);
