import "server-only";

import { db } from "../../db";

/**
 * The Cursor API key resolution: stored on Settings → Integrations → Harness
 * (DB). There is no env fallback — the key lives only in the settings store.
 */
export function cursorApiKey(): string {
  return db.getSetting<string>("cursor.api_key", "").trim();
}

/** Whether a DB-stored key is set — settings UI status. */
export function cursorApiKeyStored(): boolean {
  return Boolean(db.getSetting<string>("cursor.api_key", "").trim());
}

/** Store the Cursor API key (write-only; empty string deletes). */
export function setCursorApiKey(key: string): void {
  db.setSetting("cursor.api_key", key.trim());
}

/** Remove the stored Cursor API key. */
export function clearCursorApiKey(): void {
  db.setSetting("cursor.api_key", "");
}
