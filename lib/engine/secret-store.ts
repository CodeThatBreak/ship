import "server-only";

import { SETTINGS_KEYS } from "@/constants/settings";
import { db, type Database } from "../db";
import type { IntegrationSecretStore } from "../db/integration-secret-store";
import { processSingleton } from "../singleton";
import { settingUnknownRecord } from "../schemas/setting-values";

/**
 * Flow secrets (§4.4): stored under the `secrets` settings key as a {NAME: value}
 * map. They interpolate `{{secrets.NAME}}` in http node config at execution
 * time only — never persisted into node rows, inputs, or run events.
 */
export class SecretStore {
  constructor(
    private readonly database: Database,
    private readonly integrationSecrets: IntegrationSecretStore,
  ) {}

  /** All configured secret name → value pairs. */
  all(): Record<string, string> {
    const stored = this.database.getSetting(SETTINGS_KEYS.SECRETS, settingUnknownRecord.nullable(), null);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(stored)) {
      if (typeof v === "string" && k.trim()) raw[k.trim()] = v;
    }
    return this.integrationSecrets.openSecretsMap(raw);
  }

  /** Remove every secret value from user-renderable text (events, errors, logs). */
  redact(text: string, secrets?: Record<string, string>): string {
    let out = text ?? "";
    for (const v of Object.values(secrets ?? this.all())) {
      if (v && v.length > 3 && out.includes(v)) out = out.split(v).join("••••");
    }
    return out;
  }
}

export const secretStore = processSingleton(
  "secretStore",
  () => new SecretStore(db, db.integrationSecrets),
);
