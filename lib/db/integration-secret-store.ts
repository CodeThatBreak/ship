import "server-only";

import { SETTINGS_KEYS } from "@/constants/settings";
import { settingString } from "../schemas/setting-values";
import type { Database } from "./database";
import { AtRestCipher } from "./at-rest-cipher";

/**
 * The only module that reads or writes sealed integration token columns and
 * the Cursor API key setting value at rest.
 */
export class IntegrationSecretStore {
  constructor(
    private readonly database: Database,
    private readonly cipher: AtRestCipher,
  ) {}

  seal(plaintext: string): string {
    return this.cipher.seal(plaintext);
  }

  open(stored: string): string {
    return this.cipher.open(stored);
  }

  isSealed(value: string): boolean {
    return this.cipher.isSealed(value);
  }

  readGitLabToken(id: string): string {
    const row = this.database.get<{ token: string }>(
      `SELECT token FROM gitlab_instances WHERE id=?`,
      id,
    );
    if (!row?.token) return "";
    return this.open(row.token);
  }

  readJiraToken(id: string): string {
    const row = this.database.get<{ token: string }>(
      `SELECT token FROM jira_instances WHERE id=?`,
      id,
    );
    if (!row?.token) return "";
    return this.open(row.token);
  }

  readCursorApiKey(): string {
    const stored = this.database.getSetting(SETTINGS_KEYS.CURSOR_API_KEY, settingString, "");
    return this.open(stored).trim();
  }

  writeCursorApiKey(key: string): void {
    const trimmed = key.trim();
    this.database.setSetting(
      SETTINGS_KEYS.CURSOR_API_KEY,
      trimmed ? this.seal(trimmed) : "",
    );
  }

  /** Decrypt every value in the flow-secrets settings map. */
  openSecretsMap(raw: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && k.trim()) out[k.trim()] = this.open(v);
    }
    return out;
  }

  /** Seal every value before persisting the flow-secrets map. */
  sealSecretsMap(plain: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(plain)) {
      if (typeof v === "string" && k.trim()) out[k.trim()] = this.seal(v);
    }
    return out;
  }
}
