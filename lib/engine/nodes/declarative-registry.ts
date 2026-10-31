import "server-only";

import { z } from "zod";
import { processSingleton } from "../../singleton";
import type { NodeDefinition } from "./shared/node-definition";
import { parseDeclarativeConfig } from "./declarative-config-parser";

export interface DeclarativeRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  config: unknown;
}

export const DECLARATIVE_KINDS = ["agent", "decision", "http", "script"] as const;
export type DeclarativeKind = (typeof DECLARATIVE_KINDS)[number];

type DeclarativeKindEntry = {
  schema: z.ZodTypeAny;
  instantiate: (
    row: DeclarativeRow,
    inst?: string,
  ) => NodeDefinition<unknown, Record<string, unknown>>;
};

const isDeclarativeKind = (kind: string): kind is DeclarativeKind =>
  (DECLARATIVE_KINDS as readonly string[]).includes(kind);

export class DeclarativeKindRegistry {
  private readonly byKind = new Map<DeclarativeKind, DeclarativeKindEntry>();

  register(
    kind: DeclarativeKind,
    schema: z.ZodTypeAny,
    instantiate: DeclarativeKindEntry["instantiate"],
  ): void {
    this.byKind.set(kind, { schema, instantiate });
  }

  parseConfig(kind: string, config: unknown, name = "node"): Record<string, unknown> {
    return parseDeclarativeConfig(kind, config, name);
  }

  instantiate(
    row: DeclarativeRow,
    inst?: string,
  ): NodeDefinition<unknown, Record<string, unknown>> | undefined {
    if (!isDeclarativeKind(row.kind)) return undefined;
    return this.byKind.get(row.kind)?.instantiate(row, inst);
  }
}

export class DeclarativeDefCache {
  private readonly cache = new Map<string, NodeDefinition<unknown, Record<string, unknown>>>();

  cacheKey(defKey: string, inst?: string): string {
    return `${defKey}#${inst ?? defKey}`;
  }

  get(key: string): NodeDefinition<unknown, Record<string, unknown>> | undefined {
    return this.cache.get(key);
  }

  set(key: string, def: NodeDefinition<unknown, Record<string, unknown>>): void {
    this.cache.set(key, def);
  }

  invalidate(defKey: string): void {
    const prefix = `${defKey}#`;
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(prefix) || k === defKey) this.cache.delete(k);
    }
  }
}

export const declarativeKindRegistry = processSingleton(
  "declarativeKindRegistry",
  () => new DeclarativeKindRegistry(),
);

export const declarativeDefCache = processSingleton(
  "declarativeDefCache",
  () => new DeclarativeDefCache(),
);
