import { db } from "../../db";
import { NodeDefinition } from "./shared";
import { AgentTemplateNode } from "./kinds/agent/agent-node";
import { DecisionTemplateNode } from "./kinds/decision/decision-node";
import { HttpTemplateNode } from "./kinds/http/http-node";
import { ScriptTemplateNode } from "./kinds/script/script-node";

/**
 * Resolves `node_templates` rows of declarative kinds (agent / decision /
 * http / script) into runtime NodeDefinition instances. Rows live in the DB
 * (created via the template editor / YAML import); built-in components-in-code
 * keep registry keys, so the resolution key for declarative defs is the
 * node_templates row id, keyed per template instance (cache entry =
 * `${rowId}#${instanceKey}`).
 */
const cache = new Map<string, NodeDefinition<unknown, Record<string, unknown>>>();

export interface DeclarativeRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  config: unknown;
}

function loadRow(defKey: string): DeclarativeRow | undefined {
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
 * Instantiate a declarative def from a row: one runtime class per kind.
 * Also used by the template store to validate configs at creation time.
 */
export function instantiateDeclarative(row: DeclarativeRow, inst?: string): NodeDefinition<unknown, Record<string, unknown>> | undefined {
  switch (row.kind) {
    case "agent": return new AgentTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>;
    case "decision": return new DecisionTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>;
    case "http": return new HttpTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>;
    case "script": return new ScriptTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>;
    default: return undefined;
  }
}

/**
 * Resolve a declarative def by its node_templates id (or catalog key).
 * `inst` — the flow node's node_key: the def instance keys its row lookups on
 * it. Returns undefined for unknown ids/kinds (the registry then throws a
 * clear "unknown node type").
 */
export function declarativeDef(defKey: string, inst?: string): NodeDefinition<unknown, Record<string, unknown>> | undefined {
  const ck = cacheKey(defKey, inst);
  const hit = cache.get(ck);
  if (hit) return hit;

  const row = loadRow(defKey);
  if (!row) return undefined;
  const def = instantiateDeclarative(row, inst);
  if (!def) return undefined;
  cache.set(ck, def);
  return def;
}

/** Drop cached defs for a node_templates row so later runs re-hydrate. */
export function invalidateDeclarativeDef(defKey: string): void {
  const prefix = `${defKey}#`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix) || k === defKey) cache.delete(k);
  }
}
