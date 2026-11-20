import "server-only";

import { z } from "zod";

/**
 * No declared input contract — the input is the previous node's output.
 * Loose: extra context fields pass through unenforced.
 */
export const HttpRunInput = z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>;

/**
 * The default response contract — the fixed `{status, ok, body, headers}`
 * shape every un-mapped response satisfies (step 04: a real contract, not a
 * loose pass-through).
 */
export const HttpDefaultOutput = z.object({
  status: z.number(),
  ok: z.boolean(),
  body: z.unknown(),
  headers: z.record(z.string(), z.string()),
}) as unknown as z.ZodType<Record<string, unknown>>;

/**
 * The `response_map`-reshaped output contract: a mapped output must still be
 * an object (mapResponse already enforces that at run time — the contract
 * states it for the persisted output too).
 */
export const HttpFreeOutput = z.record(z.string(), z.unknown()) as unknown as z.ZodType<Record<string, unknown>>;
