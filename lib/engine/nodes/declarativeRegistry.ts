import "server-only";

import { z } from "zod";
import { pinnedProcessService } from "../../composition/processServices";
import type { NodeDefinition } from "./shared/nodeDefinition";
import { parseDeclarativeConfig } from "./declarativeConfigParser";

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

/** Shared declarative kind registry (decision Q9, plain module const): the
 *  registrations are static side-effect imports (`declarativeWiring.ts`) —
 *  every module-graph copy registers the same entries, so copies cannot
 *  disagree. */
export const declarativeKindRegistry = new DeclarativeKindRegistry();

/**
 * Shared declarative def cache. Process-pinned via the process-services
 * container (decision Q9): it caches DB-row-hydrated defs WITHOUT a TTL and
 * relies on explicit `invalidate()` on template edit — per-module-graph
 * copies would serve a stale def from another bundle after an edit instead
 * of re-reading the row.
 */
export const declarativeDefCache = pinnedProcessService(
  "declarativeDefCache",
  () => new DeclarativeDefCache(),
);
