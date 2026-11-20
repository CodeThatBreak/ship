import "server-only";

import type { NodeDefinition } from "../shared/nodeDefinition";

/**
 * Cache of DB-row-hydrated declarative defs, keyed `defKey#inst`. Invalidated
 * explicitly on template edit (see the pin module's comment).
 */
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
