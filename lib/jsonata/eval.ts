import jsonata from "jsonata";

/**
 * JSONata evaluation for the declarative surface (§5): edge `condition`s,
 * decision `expression`s, per-field `input_map` expressions, and http
 * `response_map`s. Expressions are compiled once and cached by text.
 *
 * jsonata v2's `evaluate()` is async (returns a Promise) even without async
 * bindings — every evaluator here is therefore awaited by its caller.
 *
 * Pure evaluator — no store / engine imports — so it serves both the engine
 * runtime and the template editor's client-side compile checks without
 * dragging server code into the browser bundle. Engine code imports this
 * module via `@/lib/jsonata` (single shared import path).
 */

type CompiledOk = { ast: jsonata.Expression };
type CompiledErr = { error: string };
const cache = new Map<string, CompiledOk | CompiledErr>();

function compiled(expr: string): CompiledOk | CompiledErr {
  const cached = cache.get(expr);
  if (cached) return cached;
  let out: CompiledOk | CompiledErr;
  try {
    const ast = jsonata(expr) as jsonata.Expression;
    out = { ast };
  } catch (e: unknown) {
    // jsonata v2 throws plain objects carrying {code, message, ...} — not
    // Error instances, so String() degrades to "[object Object]"; pull the
    // message (and code, when there is one) out properly
    out = { error: jsonataErrorMessage(e) };
  }
  if (cache.size > 200) cache.clear();
  cache.set(expr, out);
  return out;
}

function jsonataErrorMessage(e: unknown): string {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : null;
  const msg = e instanceof Error
    ? e.message
    : e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);
  return code ? `${code} — ${msg}` : msg;
}

export interface EvalResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Evaluate `expr` against `context`. JSONata returns `undefined` for no match,
 * which arrives as a missing `value` with `ok: true`.
 */
export async function evalJsonata(expr: string, context: unknown): Promise<EvalResult> {
  const c = compiled(expr);
  if ("error" in c) return { ok: false, error: `invalid expression: ${c.error}` };
  try {
    const value = await c.ast.evaluate(context);
    return { ok: true, value };
  } catch (e: unknown) {
    return { ok: false, error: jsonataErrorMessage(e) };
  }
}

/** JSONata `$boolean` semantics for edge/decision conditions (§3). */
export function jsonataTruthy(value: unknown): boolean {
  if (value === false || value == null || value === "" || value === 0) return false;
  if (typeof value === "number" && Number.isNaN(value)) return false;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return value.some((item) => jsonataTruthy(item));
  }
  if (typeof value === "object") {
    if (Object.keys(value as object).length === 0) return false;
  }
  return true;
}

/**
 * Suggest human context for a failed evaluation — the flow context only ever
 * exposes these roots.
 */
export function jsonataFail(expr: string, what: string, error: string): Error {
  return new Error(`${what}: JSONata "${expr}" failed — ${error}`);
}

/**
 * Static-check an expression without evaluating it (build-time validation, §5):
 * returns the compile error, or null when the expression compiles.
 */
export function lintJsonata(expr: string): string | null {
  const c = compiled(expr);
  return "error" in c ? `invalid expression: ${c.error}` : null;
}

/**
 * Extract the list of `{{path}}` template references inside a string, written
 * in the PromptLibrary/agent-node style (`{{task.key}}`).
 */
export function templateRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(/\{\{([^{}]+)\}\}/g)) out.push(m[1].trim());
  return out;
}
