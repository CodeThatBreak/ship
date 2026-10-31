import { LOCAL_DEFAULT_MODEL } from "@/constants/models";

/** Execution modes rendered in the Mode/Branch columns. */
export const EXECUTION_MODE_LOCAL = "local";

/**
 * The model prefilled for a local-mode flow's runs (the runtime's flagship —
 * mirrors {@link LOCAL_DEFAULT_MODEL} server-side). Cloud flows keep
 * `null` modelChoice = the account's default model.
 */
export const LOCAL_MODE_MODEL = LOCAL_DEFAULT_MODEL;
