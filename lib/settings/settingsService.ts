import "server-only";

import type { Database } from "../db/app";
import { db } from "../db/app";
import { processSingleton } from "../singleton";
import { config } from "../config";
import { normalizeModelSpec } from "../modelSpec";
import type { SettingsPatchBody } from "../schemas/settingsPatch";
import { settingString, settingStringArray, settingStringRecord } from "../schemas/settingValues";
import { SETTINGS_KEYS } from "@/constants/settings";
import { RUN_MODE, type RunMode } from "@/constants/execution";

export class SettingsService {
  constructor(private readonly database: Database) {}

  async defaultModel(): string {
    return normalizeModelSpec(
      await this.database.getSetting(SETTINGS_KEYS.DEFAULT_MODEL, settingString, "") ||
        config.defaultModel() ||
        "",
    );
  }

  /**
   * Class setting: hostname allowlist for template-authored http calls
   * (`http_allowlist`, entries match the exact hostname or a subdomain of it).
   * Empty = deny-by-default, per plan §4.4.
   */
  async httpAllowlist(): string[] {
    const raw = await this.database.getSetting(SETTINGS_KEYS.HTTP_ALLOWLIST, settingStringArray, []);
    if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
    return [];
  }

  async defaultExecutionMode(): RunMode {
    const raw = await this.database.getSetting(
          SETTINGS_KEYS.DEFAULT_EXECUTION_MODE,
          settingString,
          RUN_MODE.CLOUD,
        );
    return raw === RUN_MODE.LOCAL ? RUN_MODE.LOCAL : RUN_MODE.CLOUD;
  }

  /** Apply a validated settings patch atomically (CR-048). */
  async update(patch: SettingsPatchBody): void {
    await this.database.transaction(async () => {
            if (patch.cursor_api_key !== undefined) {
              this.database.integrationSecrets.writeCursorApiKey(patch.cursor_api_key);
            }
            if (patch.default_harness !== undefined) {
              await this.database.setSetting(SETTINGS_KEYS.DEFAULT_HARNESS, patch.default_harness);
            }
            if (patch.default_execution_mode !== undefined) {
              await this.database.setSetting(SETTINGS_KEYS.DEFAULT_EXECUTION_MODE, patch.default_execution_mode);
            }
            if (patch.default_model !== undefined) {
              await this.database.setSetting(
                          SETTINGS_KEYS.DEFAULT_MODEL,
                          normalizeModelSpec(patch.default_model.trim()),
                        );
            async }
            if (patch.local_agent) {
              const la = patch.local_agent;
              if (la.force !== undefined) {
                await this.database.setSetting(SETTINGS_KEYS.LOCAL_AGENT_FORCE, la.force);
              }
              if (la.sandbox !== undefined) {
                await this.database.setSetting(SETTINGS_KEYS.LOCAL_AGENT_SANDBOX, la.sandbox);
              }
              if (la.timeout_ms !== undefined) {
                await this.database.setSetting(SETTINGS_KEYS.LOCAL_AGENT_TIMEOUT_MS, la.timeout_ms);
              }
            }
            if (patch.secrets !== undefined) {
              const current = this.database.integrationSecrets.openSecretsMap(
                await this.database.getSetting(SETTINGS_KEYS.SECRETS, settingStringRecord, {}),
              );
              const next: Record<string, string> = { ...current };
              for (const [k, v] of Object.entries(patch.secrets)) {
                const name = k.trim();
                if (!name) continue;
                if (v == null || v === "") {
                  delete next[name];
                  continue;
                }
                next[name] = v;
              }
              await this.database.setSetting(
                          SETTINGS_KEYS.SECRETS,
                          this.database.integrationSecrets.sealSecretsMap(next),
                        );
            }
            if (patch.http_allowlist !== undefined) {
              const clean = patch.http_allowlist
                .map((h) => h.trim().toLowerCase())
                .filter(Boolean);
              await this.database.setSetting(SETTINGS_KEYS.HTTP_ALLOWLIST, clean);
            }
          });
  }
}

export const settingsService = processSingleton(
  "settingsService",
  () => new SettingsService(db),
);
