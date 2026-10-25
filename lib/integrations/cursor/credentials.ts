import { db } from "../../db";
import { config } from "../../config";

/**
 * The Cursor API key resolution order: the value saved on Settings →
 * Integrations → Harness (DB) wins over the legacy `CURSOR_API_KEY` env var.
 */
export function cursorApiKey(): string {
  const stored = db.getSetting<string>("cursor.api_key", "");
  return stored.trim() || config.cursor.apiKey();
}

/** Whether a DB-stored key is set (env fallback excluded) — settings UI status. */
export function cursorApiKeyStored(): boolean {
  return Boolean(db.getSetting<string>("cursor.api_key", "").trim());
}

/** Store the Cursor API key (write-only; empty string deletes). */
export function setCursorApiKey(key: string): void {
  db.setSetting("cursor.api_key", key.trim());
}

/** Remove the stored Cursor API key (the env fallback applies again). */
export function clearCursorApiKey(): void {
  db.setSetting("cursor.api_key", "");
}
