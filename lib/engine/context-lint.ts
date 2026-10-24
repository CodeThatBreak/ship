import { db } from "../db";
import { lintJsonata } from "./jsonata-eval";
import { lintStartContract, parseStartContract } from "./nodes/start/contract";

/**
 * Build-time checks for declarative templates (§5): every `{{nodes.X.output.Y}}`
 * reference and JSONata expression statically resolves against the template's
 * contracts before a template saves / imports. The base roots are always known
 * (task / ticket / repo / flow / trigger.payload), node outputs are known when
 * the upstream node's contract enumerates its fields (declarative kinds; built-in
 * outputs stay path-checked only).
 *
 * The `{{task.*}}` universe comes in per template — the caller (TemplateStore)
 * resolves `trigger.task_type` → task provider → `contextFields` and passes it
 * here, so this module stays pure data with no runtime class instantiation
 * (keeps the store import-cycle free): declarative output contracts are derived
 * straight from the node_templates config JSON.
 */

interface LintNode {
  key: string;
  nodeTemplateId: string;
  inputMap: Record<string, unknown>;
  config: Record<string, unknown>;
}

interface CatalogEntry {
  kind: string;
  config: unknown;
  key: string;
  isBuiltin: boolean;
}

/** The task universe passed in by the store (registry-resolved, Phase 3). */
export interface TaskUniverse {
  /** the template's declared task type (trigger.task_type) */
  kind: string;
  /** the provider's contextFields — the {{task.*}} vocabulary */
  fields: { key: string; label: string }[];
}

const ROOTS = ["task", "ticket", "repo", "flow", "trigger", "nodes", "input", "secrets"] as const;

interface LintNode {
  key: string;
  nodeTemplateId: string;
  inputMap: Record<string, unknown>;
  config: Record<string, unknown>;
}

interface CatalogEntry {
  kind: string;
  config: unknown;
  key: string;
  isBuiltin: boolean;
}

/** Where {{...}} template refs may appear in a declarative definition. */
function templateRefFields(nt: CatalogEntry): string[] {
  const cfg = (nt.config && typeof nt.config === "object" ? nt.config : {}) as Record<string, unknown>;
  switch (nt.kind) {
    case "agent":
      return [
        typeof cfg.prompt === "string" ? cfg.prompt : "",
        typeof cfg.model === "string" ? cfg.model : "",
      ];
    case "http": {
      const fields: string[] = [];
      if (typeof cfg.url === "string") fields.push(cfg.url);
      if (typeof cfg.body === "string") fields.push(cfg.body);
      const headers = cfg.headers;
      if (headers && typeof headers === "object") {
        for (const v of Object.values(headers as Record<string, unknown>)) {
          if (typeof v === "string") fields.push(v);
        }
      }
      return fields;
    }
    case "decision":
      return [typeof cfg.question === "string" ? cfg.question : ""];
    default:
      return [];
  }
}

/** The output contract (addressable fields) a definition publishes. Shared
 *  with the graph API so the canvas can show the same variables. */
export function outputFieldsFor(kind: string, config: unknown): string[] | null {
  const cfg = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  switch (kind) {
    case "agent":
      if (cfg.output === "json" && cfg.output_schema && typeof cfg.output_schema === "object") {
        const schema = cfg.output_schema as { properties?: Record<string, unknown> };
        return schema.properties ? Object.keys(schema.properties) : null; // null = any field
      }
      return ["markdown"];
    case "decision": {
      const passFields =
        cfg.pass && typeof cfg.pass === "object" && !Array.isArray(cfg.pass)
          ? Object.keys(cfg.pass as Record<string, unknown>).filter((k) => k.trim())
          : [];
      return ["chosen", "rationale", ...passFields];
    }
    case "http":
      return null; // response_map may reshape — any field passes statically
    case "script":
      if (cfg.output_schema && typeof cfg.output_schema === "object") {
        const schema = cfg.output_schema as { properties?: Record<string, unknown> };
        return schema.properties ? Object.keys(schema.properties) : null;
      }
      return null; // free-form output object
    case "builtin":
      // the start node's contract publishes exactly its declared fields
      // (other built-ins carry knob configs — parseStartContract finds none)
      return parseStartContract(cfg).length ? parseStartContract(cfg).map((f) => f.key) : null;
    default:
      return null;
  }
}

/**
 * Validate a template draft. Collects every problem into one readable message
 * (the store throws it on save/import); deprecation notices (legacy
 * `{{ticket.*}}` refs) come back as warnings — save still succeeds. Returns
 * `{ error: null, warnings: [] }` when clean.
 */
export function lintTemplate(
  nodes: LintNode[],
  edges: { from: string; to: string; condition: string | null; label: string | null; kind: string }[],
  catalog: Record<string, CatalogEntry>, // nodeTemplateId → entry
  task: TaskUniverse | null = null, // trigger.task_type → provider fields (null = unknown provider — free pass)
): { error: string | null; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  // contract lookup for {{nodes.<key>.output.<field>}} references
  interface NodeContract { fields: string[] | null; kind: string }
  const contractOfKey = new Map<string, NodeContract>();
  for (const n of nodes) {
    const nt = catalog[n.nodeTemplateId];
    if (!nt) continue; // validated() already reports unknown node templates
    const mergedConfig = merge(nt.config, n.config);
    contractOfKey.set(n.key, {
      // built-ins publish nothing addressable except a start node's contract
      fields: outputFieldsFor(nt.kind, mergedConfig),
      kind: nt.kind,
    });
    // the start contract declaration itself is validated here (loud, readable)
    if (nt.isBuiltin && nt.key === "start") {
      problems.push(...lintStartContract(mergedConfig, `node "${n.key}"`));
    }
  }

  const addressesOutput = (expr: string, onUnknown: (field: string) => void): boolean => {
    const segments = expr.split(".");
    if (segments.length < 2) return false;
    const [nodeKey, second, ...rest] = segments;
    const contract = contractOfKey.get(nodeKey);
    if (!contract) return false; // refs to unknown nodes caught by ref checks below
    if (second !== "output") return true; // small structured data lives under output
    if (contract.fields == null) return true;
    const field = rest[0]?.replace(/\*.*/, "");
    if (!field) return true;
    if (!contract.fields.includes(field)) {
      onUnknown(field);
      return false;
    }
    return true;
  };

  for (const n of nodes) {
    const nt = catalog[n.nodeTemplateId];

    // per-field input_map expressions must compile
    for (const [field, expr] of Object.entries(n.inputMap ?? {})) {
      if (typeof expr !== "string") continue;
      const err = lintJsonata(expr);
      if (err) problems.push(`node "${n.key}" input_map.${field}: ${err}`);
    }

    if (nt) {
      // the inherited input contract: the upstream next-edge parents' merged
      // published fields (null when any parent is free-form — any field passes)
      const parentKeys = edges.filter((e) => e.kind === "next" && e.to === n.key).map((e) => e.from);
      const parentContracts = parentKeys.map((k) => contractOfKey.get(k));
      const inheritedFields: string[] | null = !parentContracts.length
        ? null
        : parentContracts.some((c) => !c || c.fields == null)
          ? null
          : Array.from(new Set(parentContracts.flatMap((c) => c!.fields ?? [])));

      // {{...}} template refs in declarative definitions
      for (const ref of templateRefs(nt.config, n.config)) {
        lintRef(`node "${n.key}"`, ref, { problems, warnings, byKey, contractOfKey, addressesOutput, inHttp: nt.kind === "http", inheritedFields, task });
      }
      // instance-level config overrides (agent prompt override) may add refs
      if (nt.kind === "agent" && typeof n.config?.prompt === "string") {
        for (const ref of templateRefs(n.config.prompt, "")) {
          lintRef(`node "${n.key}" config.prompt`, ref, { problems, warnings, byKey, contractOfKey, addressesOutput, inHttp: false, inheritedFields, task });
        }
      }
      // decision definitions: the pass-down map compiles (any source); the
      // per-choice conditions and the legacy single expression when source=expression
      if (nt.kind === "decision") {
        const cfg = merge(n.config, nt.config);
        if (cfg.pass && typeof cfg.pass === "object" && !Array.isArray(cfg.pass)) {
          for (const [field, expr] of Object.entries(cfg.pass as Record<string, unknown>)) {
            if (typeof expr !== "string" || !expr.trim() || !field.trim()) continue;
            const err = lintJsonata(expr);
            if (err) problems.push(`node "${n.key}" pass variable "${field}": ${err}`);
          }
        }
        if (typeof cfg.source === "string" && cfg.source === "expression") {
          if (typeof cfg.expression === "string" && cfg.expression.trim()) {
            const err = lintJsonata(cfg.expression);
            if (err) problems.push(`node "${n.key}" decision expression: ${err}`);
          }
          if (Array.isArray(cfg.choices)) {
            for (const c of cfg.choices as { label?: unknown; condition?: unknown }[]) {
              if (!c || typeof c !== "object" || typeof c.condition !== "string" || !c.condition.trim()) continue;
              const err = lintJsonata(c.condition);
              if (err) problems.push(`node "${n.key}" choice "${String(c.label ?? "?")}" condition: ${err}`);
            }
          }
        }
      }
      // http response_map compiles
      if (nt.kind === "http") {
        const cfg = merge(n.config, nt.config);
        if (typeof cfg.response_map === "string" && cfg.response_map.trim()) {
          const err = lintJsonata(cfg.response_map);
          if (err) problems.push(`node "${n.key}" response_map: ${err}`);
        }
      }
    }
  }

  // edge + loop conditions compile
  for (const e of edges) {
    if (e.condition?.trim()) {
      const err = lintJsonata(e.condition);
      if (err) problems.push(`edge ${e.from} → ${e.to}: ${err}`);
    }
  }

  return problems.length ? { error: problems.join("\n"), warnings } : { error: null, warnings };
}

interface LintCtx {
  problems: string[];
  /** deprecation notices — reported but not fatal */
  warnings: string[];
  byKey: Map<string, LintNode>;
  contractOfKey: Map<string, { fields: string[] | null; kind: string }>;
  addressesOutput: (expr: string, onUnknown: (field: string) => void) => boolean;
  inHttp: boolean;
  /** the checked node's inherited input fields (parents' merged contracts;
   *  null = free-form — any field passes) */
  inheritedFields: string[] | null;
  /** the template's declared task type → provider fields (null = unknown) */
  task: TaskUniverse | null;
}

function lintRef(where: string, ref: string, ctx: LintCtx): void {
  const segments = ref.split(".");
  const root = segments[0];
  if (!(ROOTS as readonly string[]).includes(root)) {
    ctx.problems.push(`${where}: unknown reference {{${ref}}} — roots: task.* | repo.* | flow.* | trigger.payload.* | nodes.<key>.output.* | input.* (the upstream nodes' output)${root === "secrets" ? " | secrets.* (http nodes only)" : ""}`);
    return;
  }
  if (root === "secrets" && !ctx.inHttp) {
    ctx.problems.push(
      `${where}: {{secrets.*}} resolves only inside http node config (URL / headers / body) — secret values never persist`);
    return;
  }
  if (root === "task" || root === "ticket") {
    lintTaskRef(where, segments, ref, ctx, root === "ticket");
    return;
  }
  if (root === "input") {
    // the inherited run input — the upstream parents' merged output contract
    const field = segments[1];
    if (!field) return; // bare {{input}} renders the whole inherited object
    if (ctx.inheritedFields == null) return; // free-form — any field passes
    if (!ctx.inheritedFields.includes(field)) {
      ctx.problems.push(`${where}: the node's upstream publishes ${ctx.inheritedFields.length ? JSON.stringify(ctx.inheritedFields) : "no declared fields"} — not "${field}"`);
    }
    return;
  }
  if (root === "nodes") {
    const nodeKey = segments[1];
    if (!nodeKey || !ctx.byKey.has(nodeKey)) {
      ctx.problems.push(`${where}: {{${ref}}} references unknown node "${nodeKey ?? ""}"`);
      return;
    }
    const contract = ctx.contractOfKey.get(nodeKey);
    if (contract?.kind === "decision" && segments[2] === "output" && contract.fields != null && !contract.fields.includes(segments[3])) {
      ctx.problems.push(`${where}: node "${nodeKey}" (decision) publishes ${contract.fields.join(" / ")}, not "${segments[3] ?? ""}"`);
      return;
    }
    ctx.addressesOutput(ref, (field) => ctx.problems.push(
      `${where}: node "${nodeKey}" publishes ${field === "markdown" ? '{"markdown"}' : "fields " + JSON.stringify(ctx.contractOfKey.get(nodeKey)?.fields) + " — not .${field}"}`));
  }
}

/**
 * The {{task.*}} / {{ticket.*}} universe: the template's declared task type's
 * provider `contextFields`. An unknown field is a save error (same philosophy
 * as the {{refs}} checks — it would render empty at run time); the legacy
 * `ticket` root validates the same way but downgrades to a warning plus the
 * deprecation notice (the alias resolves the same object until Phase 4).
 */
function lintTaskRef(where: string, segments: string[], ref: string, ctx: LintCtx, deprecated: boolean): void {
  const alias = deprecated ? ` ({{ticket.*}} is deprecated — use {{task.*}}, the same context object)` : "";
  const field = segments[1];
  if (!field) {
    // bare {{task}} / {{ticket}} renders the whole task object
    if (deprecated) ctx.warnings.push(`${where}: {{ticket}} is deprecated — use {{task}} (the same context object)`);
    return;
  }
  if (ctx.task && !ctx.task.fields.some((f) => f.key === field)) {
    const published = ctx.task.fields.length
      ? "fields " + JSON.stringify(ctx.task.fields.map((f) => f.key))
      : "no declared fields";
    ctx.problems.push(
      `${where}: the template's task type ("${ctx.task.kind}") publishes ${published} — not "${field}"` + alias);
    return;
  }
  if (deprecated) {
    ctx.warnings.push(`${where}: {{ticket.${field}}} is deprecated — use {{task.${field}}} (the same context object)`);
  }
}

// ── small helpers ────────────────────────────────────────────────────────────

function templateRefs(config: unknown, instanceConfig: unknown): string[] {
  const out = new Set<string>();
  for (const ref of refsIn(config)) out.add(ref);
  for (const ref of refsIn(instanceConfig)) out.add(ref);
  return [...out];
}

/** Walk a JSON-ish config value collecting {{...}} refs from strings. */
function refsIn(value: unknown, depth = 0): string[] {
  const out: string[] = [];
  if (depth > 6 || value == null) return out;
  if (typeof value === "string") {
    return [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1].trim());
  }
  if (Array.isArray(value)) {
    for (const v of value) out.push(...refsIn(v, depth + 1));
    return out;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) out.push(...refsIn(v, depth + 1));
    return out;
  }
  return out;
}

function merge(a: unknown, b: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of [a, b]) {
    if (layer && typeof layer === "object" && !Array.isArray(layer)) {
      Object.assign(out, layer as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Catalog entries behind a template draft, straight off node_templates rows.
 */
export function catalogForNodeTemplateIds(ids: string[]): Record<string, { kind: string; config: unknown; key: string; isBuiltin: boolean }> {
  const out: Record<string, { kind: string; config: unknown; key: string; isBuiltin: boolean }> = {};
  for (const id of ids) {
    const row = db.get<{ id: string; key: string; kind: string; config: string | null; is_builtin: number }>(
      `SELECT id, key, kind, config, is_builtin FROM node_templates WHERE id=?`, id
    );
    if (!row) continue;
    let config: unknown = {};
    if (row.config) {
      try { config = JSON.parse(row.config); } catch { config = {}; }
    }
    out[row.id] = { kind: row.kind, config, key: row.key, isBuiltin: Boolean(row.is_builtin) };
  }
  return out;
}
