import "server-only";

import type { Database } from "../db/app";
import { db } from "../db/app";
import { config } from "../config";
import { normalizeModelSpec } from "../modelSpec";
import type { SettingsPatchBody } from "../schemas/settingsPatch";
import { settingString, settingStringArray, settingStringRecord } from "../schemas/settingValues";
import { SETTINGS_KEYS } from "@/constants/settings";
import { RUN_MODE, type RunMode } from "@/constants/execution";

export class SettingsService {
  constructor(private readonly database: Database) {}

  async defaultModel(): Promise<string> {
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
  async httpAllowlist(): Promise<string[]> {
    const raw = await this.database.getSetting(SETTINGS_KEYS.HTTP_ALLOWLIST, settingStringArray, []);
    if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
    return [];
  }

  async defaultExecutionMode(): Promise<RunMode> {
    const raw = await this.database.getSetting(
          SETTINGS_KEYS.DEFAULT_EXECUTION_MODE,
          settingString,
          RUN_MODE.CLOUD,
        );
    return raw === RUN_MODE.LOCAL ? RUN_MODE.LOCAL : RUN_MODE.CLOUD;
  }

  /** Apply a validated settings patch atomically (CR-048). */
  async update(patch: SettingsPatchBody): Promise<void> {
    await this.database.transaction(async (tx) => {
            if (patch.cursor_api_key !== undefined) {
              await this.database.integrationSecrets.writeCursorApiKey(patch.cursor_api_key, tx);
            }
            if (patch.default_harness !== undefined) {
              await this.database.setSetting(SETTINGS_KEYS.DEFAULT_HARNESS, patch.default_harness, tx);
            }
            if (patch.default_execution_mode !== undefined) {
              await this.database.setSetting(SETTINGS_KEYS.DEFAULT_EXECUTION_MODE, patch.default_execution_mode, tx);
            }
            if (patch.default_model !== undefined) {
              await this.database.setSetting(
                          SETTINGS_KEYS.DEFAULT_MODEL,
                          normalizeModelSpec(patch.default_model.trim()),
                          tx,
                        );
            }
            if (patch.local_agent) {
              const la = patch.local_agent;
              if (la.force !== undefined) {
                await this.database.setSetting(SETTINGS_KEYS.LOCAL_AGENT_FORCE, la.force, tx);
              }
              if (la.sandbox !== undefined) {
                await this.database.setSetting(SETTINGS_KEYS.LOCAL_AGENT_SANDBOX, la.sandbox, tx);
              }
              if (la.timeout_ms !== undefined) {
                await this.database.setSetting(SETTINGS_KEYS.LOCAL_AGENT_TIMEOUT_MS, la.timeout_ms, tx);
              }
            }
            if (patch.secrets !== undefined) {
              const current = this.database.integrationSecrets.openSecretsMap(
                await this.database.getSetting(SETTINGS_KEYS.SECRETS, settingStringRecord, {}, tx),
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
                          tx,
                        );
            }
            if (patch.http_allowlist !== undefined) {
              const clean = patch.http_allowlist
                .map((h) => h.trim().toLowerCase())
                .filter(Boolean);
              await this.database.setSetting(SETTINGS_KEYS.HTTP_ALLOWLIST, clean, tx);
            }
          });
  }
}

/** Shared settings service (stateless, db-injected — decision Q9, plain module const). */
export const settingsService = new SettingsService(db);
