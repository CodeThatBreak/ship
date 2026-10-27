/** Execution modes rendered in the Mode/Branch columns. */
export const EXECUTION_MODE_LOCAL = "local";

/**
 * The model prefilled for a local-mode flow's runs (the runtime's flagship —
 * mirrors the local agent port's fallback list server-side). Cloud flows keep
 * `null` modelChoice = the account's default model.
 */
export const LOCAL_MODE_MODEL = "composer-2.5";
