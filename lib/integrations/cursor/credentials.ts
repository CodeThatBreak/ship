import "server-only";

import { db } from "../../db";
import { settingString } from "../../schemas/setting-values";

/**
 * The Cursor API key resolution: stored on Settings → Integrations → Harness
 * (DB). There is no env fallback — the key lives only in the settings store.
 */
export function cursorApiKey(): string {
  return db.getSetting("cursor.api_key", settingString, "").trim();
}

/** Whether a DB-stored key is set — settings UI status. */
export function cursorApiKeyStored(): boolean {
  return Boolean(db.getSetting("cursor.api_key", settingString, "").trim());
}

/** Store the Cursor API key (write-only; empty string deletes). */
export function setCursorApiKey(key: string): void {
  db.setSetting("cursor.api_key", key.trim());
}

/** Remove the stored Cursor API key. */
export function clearCursorApiKey(): void {
  db.setSetting("cursor.api_key", "");
}
