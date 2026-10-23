import { db } from "../../db";
import { NodeDefinition } from "./base";
import { AgentTemplateNode } from "./agent/agent-node";

/**
 * Resolves `node_templates` rows of declarative kinds (agent, …) into runtime
 * NodeDefinition instances. Rows live in the DB (created via the template
 * editor / YAML import); built-in components-in-code keep registry keys, so
 * the resolution key for declarative defs is the node_templates row id, keyed
 * per template instance (cache entry = `${rowId}#${instanceKey}`).
 */
const cache = new Map<string, NodeDefinition<unknown, Record<string, unknown>>>();

function loadRow(defKey: string): { id: string; name: string; description: string | null; kind: string; config: unknown } | undefined {
  const decode = (r: Record<string, unknown> | undefined) => {
    if (!r) return undefined;
    if (typeof r.config === "string") {
      try { r.config = JSON.parse(r.config); } catch { r.config = {}; }
    }
    return r as never;
  };
  // db.get returns raw rows — the config column is a TEXT JSON blob here
  const byId = db.get<Record<string, unknown>>(
    `SELECT id, name, description, kind, config FROM node_templates WHERE id=?`, defKey
  );
  if (byId) return decode(byId);
  // resolution by catalog key (declarative keys never collide with built-ins —
  // creation refuses builtin-key matches)
  const byKey = db.get<Record<string, unknown>>(
    `SELECT id, name, description, kind, config FROM node_templates WHERE key=? AND is_builtin=0`, defKey
  );
  return decode(byKey);
}

const cacheKey = (defKey: string, inst?: string): string => `${defKey}#${inst ?? defKey}`;

/**
 * Resolve a declarative def by its node_templates id (or catalog key).
 * `inst` — the flow node's node_key: the def instance keys its row lookups on
 * it. Returns undefined for unknown ids (Phase 3 kinds resolve undefined too).
 */
export function declarativeDef(defKey: string, inst?: string): NodeDefinition<unknown, Record<string, unknown>> | undefined {
  const ck = cacheKey(defKey, inst);
  const hit = cache.get(ck);
  if (hit) return hit;

  const row = loadRow(defKey);
  if (!row || row.kind !== "agent") {
    // unknown rows and Phase 3 kinds (http / script / decision) stay unresolved
    return undefined;
  }
  const def = new AgentTemplateNode(row, inst);
  cache.set(ck, def as NodeDefinition<unknown, Record<string, unknown>>);
  return def as NodeDefinition<unknown, Record<string, unknown>>;
}

/** Drop cached defs for a node_templates row so later runs re-hydrate. */
export function invalidateDeclarativeDef(defKey: string): void {
  const prefix = `${defKey}#`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix) || k === defKey) cache.delete(k);
  }
}
