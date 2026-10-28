/** Chat-level option types shared between ChatPanel and its subcomponents. */

/** Options for plan-style runs (the decompose toggle). */
export type PlanOptions = { decompose: boolean };

/** Start options for a node's first run (from the prompt modal's Run). */
export type PlanStartOpts = { prompt?: string; promptIsBody?: boolean };
