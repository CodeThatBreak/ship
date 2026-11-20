import "server-only";

import { z } from "zod";

/** The default fan-out aggregate contract every fan-out-capable def publishes. */
export const DEFAULT_FANOUT_OUTPUT = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      branch: z.string().optional(),
      artifact_id: z.string().optional(),
      output: z.unknown().optional(),
    })
  ),
});

/** The split consumer's worst-of aggregate shape (moved from the split runtime
 *  so the contract seam owns both defaults next to the fan-out one). */
export const DEFAULT_SPLIT_OUTPUT = z.object({
  units: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      status: z.string(),
      output: z.unknown().optional(),
    })
  ),
});
