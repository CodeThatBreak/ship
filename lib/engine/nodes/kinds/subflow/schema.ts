import "server-only";

import { z } from "zod";

/**
 * No declared input contract — the input is the previous node's output.
 * Loose: extra context fields pass through unenforced. The stage gate (not
 * this def) consumes the input: the node's `input_map` evaluates over it and
 * the result becomes the child flow's start payload.
 */
export const SubflowRunInput = z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>;

/**
 * The terminal contract — the child's terminal output (or the declared
 * `pass` mapping) publishes as this node's aggregate. Free object: the child
 * template owns its own output shape; a `pass` mapping reshapes it at rollup
 * time and the mapped fields still satisfy the record.
 */
export const SubflowFreeOutput = z.record(z.string(), z.unknown()) as unknown as z.ZodType<Record<string, unknown>>;
