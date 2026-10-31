import "server-only";

import type { IntegrationSecretStore } from "../../db/integrationSecretStore";
import { processSingleton } from "../../singleton";
import { db } from "../../db/app";

/**
 * The Cursor API key resolution: stored on Settings → Integrations → Harness
 * (DB). There is no env fallback — the key lives only in the settings store.
 */
export class CursorCredentials {
  constructor(private readonly secrets: IntegrationSecretStore) {}

  apiKey(): string {
    return this.secrets.readCursorApiKey();
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
    this.secrets.writeCursorApiKey(trimmed);
  }

  clear(): void {
    this.secrets.writeCursorApiKey("");
  }
}

export const cursorCredentials = processSingleton(
  "cursorCredentials",
  () => new CursorCredentials(db.integrationSecrets),
);
