import "server-only";

import { db } from "../../../../db/app";
import { settingString } from "../../../../schemas/settingValues";

/** The user-selected default harness (the `default_harness` setting), or
 *  null — unset/empty means "no preference" and AgentPortRegistry.forMode
 *  falls back to the first port registered for the mode. Read per selection so
 *  a settings change takes effect without a restart. */
export const defaultHarnessSetting = async (): Promise<string | null> => {
  return (await db.getSetting("default_harness", settingString, "")) || null;
};
