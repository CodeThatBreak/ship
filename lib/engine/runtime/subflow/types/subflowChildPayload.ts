import "server-only";

/**
 * The subflow child's trigger payload (task 26): the input_map-evaluated
 * START FIELDS ride top-level — the child's start contract validates exactly
 * these, twice (flowFactory's `createStepChild` validation, and the child
 * Start node's own run re-validates the persisted payload). A
 * contract-declared child therefore carries ONLY its contract fields.
 *
 * The linkage rides beside the fields ONLY when the child declares no start
 * contract (a contract-clean payload cannot carry engine envelope keys —
 * `validateAgainstContract` rejects unknown fields). A contract-declared
 * child is linked by derivation at rollup time: the parent's RUNNING
 * declarative-subflow node whose `child` config names the child's template.
 *
 * The `subflow` marker is also the runtime-owned discriminator: fan-out step
 * children carry the `{plan, step, siblings}` shape and never this key, so
 * the rollup no-ops on them.
 */
export interface SubflowChildPayload {
  /** the parent node instance key that owns this child (rollup addressing) */
  parentNodeKey?: string;
  /** the subflow marker (absent on contract-declared children — see above) */
  subflow?: { child: string };
  /** the evaluated input_map fields (the child's start-contract payload) */
  [field: string]: unknown;
}
