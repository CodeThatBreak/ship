import "server-only";

/** Split knobs a node-target child's copied config strips (a child never
 *  splits — the nesting guard is the runtime rule, the strip is hygiene). */
export const SPLIT_CONFIG_KEYS = ["split_consume", "split_parallel_max"] as const;
