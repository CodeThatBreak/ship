import "server-only";

import { db } from "../db";
import { settingStringArray, settingUnknownRecord } from "../schemas/setting-values";

/**
 * Secrets (§4.4): stored under the `secrets` settings key as a {NAME: value}
 * map. They interpolate `{{secrets.NAME}}` in http node config at execution
 * time only — never persisted into node rows, inputs, or run events.
 */

export function getSecrets(): Record<string, string> {
  const stored = db.getSetting("secrets", settingUnknownRecord.nullable(), null);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (typeof v === "string" && k.trim()) out[k.trim()] = v;
  }
  return out;
}

/** Remove every secret value from user-renderable text (events, errors, logs). */
export function redactSecrets(text: string, secrets?: Record<string, string>): string {
  let out = text ?? "";
  for (const v of Object.values(secrets ?? getSecrets())) {
    if (v && v.length > 3 && out.includes(v)) out = out.split(v).join("••••");
  }
  return out;
}

/**
 * Class setting: hostname allowlist for template-authored http calls
 * (`http_allowlist`, entries match the exact hostname or a subdomain of it).
 * Empty = deny-by-default, per plan §4.4.
 */
export function httpAllowlist(): string[] {
  const raw = db.getSetting("http_allowlist", settingStringArray, []);
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return [];
}
