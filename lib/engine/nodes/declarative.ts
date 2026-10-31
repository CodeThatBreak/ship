import "server-only";

import { z } from "zod";
import { db } from "../../db";
import { NodeDefinition } from "./shared";
import {
  declarativeDefCache,
  declarativeKindRegistry,
  type DeclarativeRow,
} from "./declarative-registry";

export type { DeclarativeRow } from "./declarative-registry";

const DeclarativeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  config: z.unknown(),
});

const loadRow = (defKey: string): DeclarativeRow | undefined => {
  const decode = (r: Record<string, unknown> | undefined): DeclarativeRow | undefined => {
    if (!r) return undefined;
    let row = r;
    if (typeof row.config === "string") {
      try {
        row = { ...row, config: JSON.parse(row.config) };
      } catch {
        return undefined;
      }
    }
    const parsed = DeclarativeRowSchema.safeParse(row);
    return parsed.success ? parsed.data : undefined;
  };
  const byId = db.get<Record<string, unknown>>(
    `SELECT id, name, description, kind, config FROM node_templates WHERE id=?`, defKey
  );
  if (byId) return decode(byId);
  const byKey = db.get<Record<string, unknown>>(
    `SELECT id, name, description, kind, config FROM node_templates WHERE key=? AND is_builtin=0`, defKey
  );
  return decode(byKey);
};

export const instantiateDeclarative = (
  row: DeclarativeRow,
  inst?: string,
): NodeDefinition<unknown, Record<string, unknown>> | undefined =>
  declarativeKindRegistry.instantiate(row, inst);

export const declarativeDef = (
  defKey: string,
  inst?: string,
): NodeDefinition<unknown, Record<string, unknown>> | undefined => {
  const ck = declarativeDefCache.cacheKey(defKey, inst);
  const hit = declarativeDefCache.get(ck);
  if (hit) return hit;

  const row = loadRow(defKey);
  if (!row) return undefined;
  const def = instantiateDeclarative(row, inst);
  if (!def) return undefined;
  declarativeDefCache.set(ck, def);
  return def;
};

export const invalidateDeclarativeDef = (defKey: string): void => {
  declarativeDefCache.invalidate(defKey);
};
