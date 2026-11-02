import { LOCAL_DEFAULT_MODEL } from "@/constants/models";

/** Execution modes rendered in the Mode/Branch columns. */
import { RUN_MODE } from "@/constants/execution";

/** @deprecated Prefer RUN_MODE.LOCAL */
export const EXECUTION_MODE_LOCAL = RUN_MODE.LOCAL;

/**
 * The model prefilled for a local-mode flow's runs (the runtime's flagship —
 * mirrors {@link LOCAL_DEFAULT_MODEL} server-side). Cloud flows keep
 * `null` modelChoice = the account's default model.
 */
export const LOCAL_MODE_MODEL = LOCAL_DEFAULT_MODEL;
