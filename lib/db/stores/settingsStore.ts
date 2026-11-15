import "server-only";

import type { z } from "zod";
import type { Database } from "../database";

/** App-level settings (execution defaults, local agent options). */
export class SettingsStore {
  constructor(private readonly db: Database) {}

  async getSetting<S extends z.ZodTypeAny>(key: string, schema: S, fallback: z.infer<S>): Promise<z.infer<S>> {
    const row = await this.db.prisma.setting.findUnique({ where: { key } });
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
    await this.db.prisma.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
  }
}
