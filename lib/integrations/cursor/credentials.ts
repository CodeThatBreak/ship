import "server-only";

import { SETTINGS_KEYS } from "@/constants/settings";
import { db, type Database } from "../../db";
import { processSingleton } from "../../singleton";
import { settingString } from "../../schemas/setting-values";

/**
 * The Cursor API key resolution: stored on Settings → Integrations → Harness
 * (DB). There is no env fallback — the key lives only in the settings store.
 *
 * Plaintext at rest today; encryption is tracked in Task 61.
 */
export class CursorCredentials {
  constructor(private readonly database: Database) {}

  apiKey(): string {
    return this.database.getSetting(SETTINGS_KEYS.CURSOR_API_KEY, settingString, "").trim();
  }

  /** Whether a DB-stored key is set — settings UI status. */
  isStored(): boolean {
    return Boolean(this.apiKey());
  }

  /** Store the Cursor API key (write-only). Empty input clears the stored key. */
  setApiKey(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      this.clear();
      return;
    }
    this.database.setSetting(SETTINGS_KEYS.CURSOR_API_KEY, trimmed);
  }

  clear(): void {
    this.database.setSetting(SETTINGS_KEYS.CURSOR_API_KEY, "");
  }
}

export const cursorCredentials = processSingleton(
  "cursorCredentials",
  () => new CursorCredentials(db),
);
