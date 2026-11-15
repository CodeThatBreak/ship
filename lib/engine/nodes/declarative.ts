import "server-only";

import { z } from "zod";
import { db } from "../../db/app";
import { NodeDefinition } from "./shared/nodeSharedExports";
import {
  declarativeDefCache,
  declarativeKindRegistry,
  type DeclarativeRow,
} from "./declarativeRegistry";

export type { DeclarativeRow } from "./declarativeRegistry";

const DeclarativeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  config: z.unknown(),
});

const loadRow = async (defKey: string): Promise<DeclarativeRow | undefined> => {
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
  const byId = await db.prisma.nodeTemplate.findUnique({
    where: { id: defKey },
    select: { id: true, name: true, description: true, kind: true, config: true },
  });
  if (byId) return decode(byId as Record<string, unknown>);
  const byKey = await db.prisma.nodeTemplate.findFirst({
    where: { key: defKey, isBuiltin: false },
    select: { id: true, name: true, description: true, kind: true, config: true },
  });
  return decode(byKey as Record<string, unknown> | undefined);
};

export const instantiateDeclarative = (
  row: DeclarativeRow,
  inst?: string,
): NodeDefinition<unknown, Record<string, unknown>> | undefined =>
  declarativeKindRegistry.instantiate(row, inst);

export const declarativeDef = async (
  defKey: string,
  inst?: string,
): Promise<NodeDefinition<unknown, Record<string, unknown>> | undefined> => {
  const ck = declarativeDefCache.cacheKey(defKey, inst);
  const hit = declarativeDefCache.get(ck);
  if (hit) return hit;

  const row = await loadRow(defKey);
  if (!row) return undefined;
  const def = instantiateDeclarative(row, inst);
  if (!def) return undefined;
  declarativeDefCache.set(ck, def);
  return def;
};

export const invalidateDeclarativeDef = (defKey: string): void => {
  declarativeDefCache.invalidate(defKey);
};
