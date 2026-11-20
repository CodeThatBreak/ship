import "server-only";

import type { NodeDefinition } from "./nodeDefinition";

/** The NodeDefinition brand + its HMR-stable type guard (out-of-class module
 *  members per the class-file purity rule — step 04 moved them here, which
 *  also shrank the NodeDefinition class file under its size ceiling). */

export const NODE_DEFINITION_BRAND = "devflow.NodeDefinition.v1";

/**
 * Type guard for any `NodeDefinition` instance, stable across dev-server
 * module-graph re-evaluations — the instanceof-proof counterpart to the
 * class's HMR-stable brand (see `NodeDefinition.IS_NODE_DEFINITION`):
 * a hot-reloaded route gets a fresh class copy while the `globalThis`-pinned
 * kind registry still holds instances built by the previous copy, so
 * cross-boundary checks compare the brand instead. Type-only import — the
 * runtime check is the brand string, so no module cycle.
 */
export const isNodeDefinition = (
  value: unknown,
): value is NodeDefinition<unknown, Record<string, unknown>> => {
  if (typeof value !== "object" || value === null) return false;
  const ctor = (value as { constructor?: { IS_NODE_DEFINITION?: string } }).constructor;
  return ctor?.IS_NODE_DEFINITION === NODE_DEFINITION_BRAND;
};
