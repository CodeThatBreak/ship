/**
 * TS-lite converters for authoring agent nodes (§8 form).
 *
 * The agent runtime takes a full JSON Schema (`output_schema`, validated by
 * the lite validator at run time). The authoring box accepts plain
 * TypeScript-style object bodies — just the members between `{ }` (braces
 * optional, no `interface` wrapper) — and compiles down to that schema. The
 * flat `{key, label, type, required}` input-row helpers keep authoring the
 * input contract (old rows whose inputs predate parent-output inheritance
 * just carry inert extra data the engine ignores).
 *
 * Deliberately a subset, not a TypeScript compiler:
 *   • members `name[?]: type`, separated by `;` / `,` / newlines
 *   • primitives (string / number / boolean / integer), `null` unions,
 *     string-literal unions (→ enum), `T[]` / `Array<T>`, `Record<K, V>`
 *   • nested inline `{ … }` objects at any depth
 *   • unknown type names degrade to a permissive schema (no imports)
 */

export interface InputFieldRow {
  key: string;
  label?: string;
  /** the runtime's row types — object/array are structured placeholders */
  type?: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
}

export interface LiteSchema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, LiteSchema>;
  required?: string[];
  items?: LiteSchema;
  additionalProperties?: LiteSchema | boolean;
  description?: string;
}

// ── parsing ──────────────────────────────────────────────────────────────────

/** Split on any of `seps` at zero bracket depth, ignoring quoted strings. */
function splitTopLevel(s: string, seps: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ("{[(".includes(ch)) depth++;
    else if ("}])".includes(ch)) depth--;
    if (depth === 0 && seps.includes(ch)) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** The braces-balanced check for a friendlier error on unclosed objects. */
function bracesBalanced(s: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth === 0;
}

/** Cut a `// …` line comment (outside quotes — URLs in strings stay intact). */
function stripLineComments(s: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === "/" && s[i + 1] === "/") {
      // skip to the end of THIS line only (keep the newline)
      const nl = s.indexOf("\n", i);
      if (nl === -1) break;
      out += "\n";
      i = nl;
      continue;
    }
    out += ch;
  }
  return out;
}

function objectSchema(body: string): LiteSchema {
  const props: Record<string, LiteSchema> = {};
  const required: string[] = [];
  for (const raw of splitTopLevel(body, ";,\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([\s\S]+)$/);
    if (!m) continue; // index signatures / methods / stray comments — skipped
    const [, name, opt, type] = m;
    props[name] = parseTypeText(type);
    if (!opt) required.push(name);
  }
  const out: LiteSchema = { type: "object" };
  if (Object.keys(props).length) {
    out.properties = props;
    if (required.length) out.required = required;
  }
  return out;
}

/** One TS type annotation → a lite JSON Schema node. */
function parseTypeText(t0: string): LiteSchema {
  const t = stripLineComments(t0).trim().replace(/;+$/, "").trim();
  if (!t || t === "any" || t === "unknown") return {};
  // T[]
  if (t.endsWith("[]")) return { type: "array", items: parseTypeText(t.slice(0, -2)) };
  const arrWrap = t.match(/^Array<([\s\S]+)>$/);
  if (arrWrap) return { type: "array", items: parseTypeText(arrWrap[1]) };
  // unions — split at top level on |
  const parts = splitTopLevel(t, "|");
  if (parts.length > 1) {
    const nullable = parts.some((p) => p === "null" || p === "undefined");
    const rest = parts.filter((p) => p !== "null" && p !== "undefined");
    if (!rest.length) return { type: "null" };
    // all string literals → enum
    if (rest.every((p) => /^"[^"]*"$|^'[^']*'$/.test(p))) {
      const values = rest.map((p) => p.slice(1, -1));
      return nullable
        ? { type: ["string", "null"], enum: [...values, null] }
        : { type: "string", enum: values };
    }
    const subs = rest.map((p) => parseTypeText(p));
    if (subs.every((s) => typeof s.type === "string" && !s.enum && !s.properties && !s.items)) {
      const set = Array.from(new Set(subs.map((s) => s.type as string)));
      return { type: nullable ? [...set, "null"] : set.length === 1 ? set[0] : set };
    }
    return { type: "object" }; // complex unions degrade permissively
  }
  // inline object literal (any depth)
  if (t.startsWith("{") && t.endsWith("}")) return objectSchema(t.slice(1, -1));
  // Record<K, V>
  const rec = t.match(/^Record<\s*[^,<]+(?:<[\s\S]*?>)?\s*,\s*([\s\S]+)\s*>$/);
  if (rec) return { type: "object", additionalProperties: parseTypeText(rec[1]) };
  // bare string literal
  if (/^"[^"]*"$|^'[^']*'$/.test(t)) return { type: "string", enum: [t.slice(1, -1)] };
  // primitives
  if (t === "string") return { type: "string" };
  if (t === "number") return { type: "number" };
  if (t === "integer") return { type: "integer" };
  if (t === "boolean") return { type: "boolean" };
  return {}; // unknown names (Date, imported types …) → permissive
}

/** The bare authoring source → a schema: `{ … }` body or just the members. */
function parseObjectBody(src: string): { schema?: LiteSchema; error?: string } {
  const clean = stripLineComments(src);
  if (!bracesBalanced(clean)) return { error: "unclosed { — close your object" };
  const t = clean.trim();
  const schema = t.startsWith("{") && t.endsWith("}") ? objectSchema(t.slice(1, -1)) : objectSchema(t);
  if (!schema.properties) return { error: "no field members found — declare e.g. `task: string`" };
  return { schema };
}

// ── contracts for the authoring form ─────────────────────────────────────────

export interface ContractParse {
  inputs: InputFieldRow[];
  error?: string;
}

/** The Input box → the agent's declared input field rows. */
export function parseInputContract(src: string): ContractParse {
  const r = parseObjectBody(src);
  if (r.error || !r.schema) return { inputs: [], error: r.error };
  return { inputs: schemaToInputRows(r.schema) };
}

export interface OutputParse {
  schema: LiteSchema | null;
  error?: string;
}

/** The Output box → the agent's `output_schema` (validated at run time). */
export function parseOutputContract(src: string): OutputParse {
  const r = parseObjectBody(src);
  if (r.error) return { schema: null, error: r.error };
  return { schema: r.schema ?? null };
}

/** Flatten a schema's TOP-LEVEL object properties into input field rows —
 *  the display shape the configurator's contract table uses. */
export function schemaToInputRows(schema: LiteSchema | null): InputFieldRow[] {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([key, sub]) => {
    const types = Array.isArray(sub.type) ? sub.type : [sub.type];
    const base = sub.enum ? "string" : types.find((x) => x != null);
    const type: InputFieldRow["type"] | undefined =
      base === "string" ? "string" :
      base === "number" || base === "integer" ? "number" :
      base === "boolean" ? "boolean" :
      base === "array" ? "array" :
      base === "object" ? "object" :
      base == null ? undefined : "object";
    return {
      key,
      label: sub.description ?? undefined,
      type,
      required: required.has(key),
    };
  });
}
