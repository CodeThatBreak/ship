import "server-only";

import type { IntegrationSecretStore } from "../../db/integrationSecretStore";
import { db } from "../../db/app";

/**
 * The Cursor API key resolution: stored on Settings → Integrations → Harness
 * (DB). There is no env fallback — the key lives only in the settings store.
 */
export class CursorCredentials {
  constructor(private readonly secrets: IntegrationSecretStore) {}

  async apiKey(): Promise<string> {
    return this.secrets.readCursorApiKey();
  }

  /** Whether a DB-stored key is set — settings UI status. */
  async isStored(): Promise<boolean> {
    return Boolean(await this.apiKey());
  }

  /** Store the Cursor API key (write-only). Empty input clears the stored key. */
  async setApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      await this.clear();
      return;
    }
    await this.secrets.writeCursorApiKey(trimmed);
  }

  async clear(): Promise<void> {
    await this.secrets.writeCursorApiKey("");
  }
}

/** Shared Cursor credentials (stateless, db-injected — decision Q9, plain module const). */
export const cursorCredentials = new CursorCredentials(db.integrationSecrets);
