import "server-only";

import type SqliteDatabase from "better-sqlite3";
import { SETTINGS_KEYS } from "@/constants/settings";
import type { AtRestCipher } from "../at-rest-cipher";

const sealColumn = (
  d: SqliteDatabase.Database,
  table: "gitlab_instances" | "jira_instances",
  cipher: AtRestCipher,
): void => {
  const rows = d.prepare(`SELECT id, token FROM ${table}`).all() as { id: string; token: string }[];
  const upd = d.prepare(`UPDATE ${table} SET token=? WHERE id=?`);
  for (const row of rows) {
    if (row.token && !cipher.isSealed(row.token)) {
      upd.run(cipher.seal(row.token), row.id);
    }
  }
};

const sealCursorApiKey = (d: SqliteDatabase.Database, cipher: AtRestCipher): void => {
  const row = d
    .prepare(`SELECT value FROM settings WHERE key=?`)
    .get(SETTINGS_KEYS.CURSOR_API_KEY) as { value: string } | undefined;
  if (!row?.value) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return;
  }
  if (typeof parsed !== "string" || !parsed || cipher.isSealed(parsed)) return;
  d.prepare(`UPDATE settings SET value=? WHERE key=?`).run(
    JSON.stringify(cipher.seal(parsed)),
    SETTINGS_KEYS.CURSOR_API_KEY,
  );
};

const sealFlowSecretsMap = (d: SqliteDatabase.Database, cipher: AtRestCipher): void => {
  const row = d
    .prepare(`SELECT value FROM settings WHERE key=?`)
    .get(SETTINGS_KEYS.SECRETS) as { value: string } | undefined;
  if (!row?.value) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const next: Record<string, string> = {};
  let changed = false;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string" || !k.trim()) continue;
    if (!cipher.isSealed(v)) {
      next[k.trim()] = cipher.seal(v);
      changed = true;
    } else {
      next[k.trim()] = v;
    }
  }
  if (!changed) return;
  d.prepare(`UPDATE settings SET value=? WHERE key=?`).run(
    JSON.stringify(next),
    SETTINGS_KEYS.SECRETS,
  );
};

/** One-time migration: seal plaintext integration tokens and settings secrets (Task 61). */
export const sealIntegrationSecretsAtRest = (
  d: SqliteDatabase.Database,
  cipher: AtRestCipher,
): void => {
  sealColumn(d, "gitlab_instances", cipher);
  sealColumn(d, "jira_instances", cipher);
  sealCursorApiKey(d, cipher);
  sealFlowSecretsMap(d, cipher);
};
