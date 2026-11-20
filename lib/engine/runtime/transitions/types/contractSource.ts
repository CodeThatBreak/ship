import "server-only";

import type { NodeDefinition } from "../../../nodes/shared/nodeDefinition";

/**
 * The def-resolution port the transition authority's contract seam reads
 * through (step 04). The authority must not know how defs hydrate (registry
 * keys vs declarative template rows) — the composition binds the engine's
 * resolver (`FlowEngine.defOf`) at construction via `bindOutcomeContracts`.
 * Unbound (pre-composition direct constructions in tests) the seam skips —
 * the arch-test inventory keeps that from growing.
 */
export interface OutcomeContractSource {
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition | null>;
}
