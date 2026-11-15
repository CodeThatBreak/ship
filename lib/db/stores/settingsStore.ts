import "server-only";

import type { z } from "zod";
import type { Database } from "../database";

export class SettingsStore {
  constructor(private readonly db: Database) {}

  async getSetting<S extends z.ZodTypeAny>(key: string, schema: S, fallback: z.infer<S>): Promise<z.infer<S>> {
    const row = await this.db.get<{ value: string }>(`SELECT value FROM settings WHERE key=$1`, key);
    if (!row) return fallback;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return fallback;
    }
    const result = schema.safeParse(parsed);
    return result.success ? result.data : fallback;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key,value) VALUES ($1,$2)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      key,
      JSON.stringify(value),
    );
  }
}
