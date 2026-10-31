import "server-only";

import type { Database } from "../db";
import { normalizeModelSpec } from "../modelSpec";
import type { SettingsPatchBody } from "../schemas/settings-patch";
import { settingStringRecord } from "../schemas/setting-values";

export class SettingsService {
  constructor(private readonly database: Database) {}

  /** Apply a validated settings patch atomically (CR-048). */
  update(patch: SettingsPatchBody): void {
    this.database.transaction(() => {
      if (patch.cursor_api_key !== undefined) {
        const key = patch.cursor_api_key.trim();
        this.database.setSetting("cursor.api_key", key);
      }
      if (patch.default_harness !== undefined) {
        this.database.setSetting("default_harness", patch.default_harness);
      }
      if (patch.default_execution_mode !== undefined) {
        this.database.setSetting("default_execution_mode", patch.default_execution_mode);
      }
      if (patch.default_model !== undefined) {
        this.database.setSetting(
          "default_model",
          normalizeModelSpec(patch.default_model.trim()),
        );
      }
      if (patch.local_agent) {
        const la = patch.local_agent;
        if (la.force !== undefined) {
          this.database.setSetting("local_agent.force", la.force);
        }
        if (la.sandbox !== undefined) {
          this.database.setSetting("local_agent.sandbox", la.sandbox);
        }
        if (la.timeout_ms !== undefined) {
          this.database.setSetting("local_agent.timeout_ms", la.timeout_ms);
        }
      }
      if (patch.secrets !== undefined) {
        const current = this.database.getSetting("secrets", settingStringRecord, {});
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
        this.database.setSetting("secrets", next);
      }
      if (patch.http_allowlist !== undefined) {
        const clean = patch.http_allowlist
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean);
        this.database.setSetting("http_allowlist", clean);
      }
    });
  }
}
