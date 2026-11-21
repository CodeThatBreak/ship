/** The `pipeline` artifact's meta keys (§2.7) — the identity the renderer
 *  needs to route its affordance: the gate saves the snapshot on its own
 *  node, so the retrigger verb's target rides the meta (the payload is the
 *  pipeline's state, not the node's). */
export const PIPELINE_FACT_META = {
  /** the node key the `retrigger_pipeline` verb dispatches to */
  NODE_KEY: "nodeKey",
} as const;
