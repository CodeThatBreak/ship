/**
 * The condition builder's grammar (Phase 5): rows of `[path][op][value]`
 * ⇄ one JSONata expression. Pure data — no React, no engine imports — so the
 * compile/decompose round-trip is unit-testable in isolation (the builder
 * component and the round-trip tests both import it).
 *
 * Every op compiles to an expression the runtime actually evaluates:
 *   = / ≠ / > / <  plain comparisons (values typed as JSON literals)
 *   contains        $contains(path, "value")
 *   is empty        missing OR null OR "" — the useful meaning of "empty"
 *   is not empty    present AND non-null AND non-""
 */

export type ConditionOp = "eq" | "ne" | "gt" | "lt" | "contains" | "empty" | "notEmpty";

export type ConditionValueKind = "string" | "number" | "boolean" | "null";

export interface ConditionRow {
  path: string;
  op: ConditionOp;
  /** the value as typed in the builder (quoting is applied at compile time) */
  value: string;
  valueKind: ConditionValueKind;
}

/** A JSONata literal on the rhs → display value + kind; non-literals → null. */
export function parseJsonataLiteral(
  lit: string,
): { value: string; valueKind: ConditionValueKind } | null {
  const t = (lit ?? "").trim();
  if (t === '""' || t === "''") return { value: "", valueKind: "string" };
  if (t === "null") return { value: "null", valueKind: "null" };
  if (t === "true" || t === "false") return { value: t, valueKind: "boolean" };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { value: t, valueKind: "number" };
  const dq = /^"(.*)"$/.exec(t);
  if (dq) return { value: dq[1], valueKind: "string" };
  const sq = /^'(.*)'$/.exec(t);
  if (sq) return { value: sq[1], valueKind: "string" };
  return null;
}

/** Infer how a freshly typed value should compile on the next emit. */
export function inferValueKind(raw: string): ConditionValueKind {
  const t = raw.trim();
  if (t === "null") return "null";
  if (t === "true" || t === "false") return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(t)) return "number";
  return "string";
}

/** The typed text → a JSONata literal (numbers / booleans bare, else a string). */
export function literal(raw: string, kind: ConditionValueKind): string {
  const t = raw.trim();
  if (kind === "null") return "null";
  if (kind === "boolean") {
    return t === "true" || t === "false" ? t : JSON.stringify(t);
  }
  if (kind === "number") return t;
  if (t === "") return '""';
  return JSON.stringify(t);
}

/** @deprecated use parseJsonataLiteral — kept for any external imports */
export function unliteral(lit: string): string {
  return parseJsonataLiteral(lit)?.value ?? lit.trim();
}

export function rowExpr(r: ConditionRow): string | null {
  const path = r.path.trim();
  if (!path) return null;
  switch (r.op) {
    case "eq":
      return `${path} = ${literal(r.value, r.valueKind)}`;
    case "ne":
      return `${path} != ${literal(r.value, r.valueKind)}`;
    case "gt":
      return `${path} > ${literal(r.value, r.valueKind)}`;
    case "lt":
      return `${path} < ${literal(r.value, r.valueKind)}`;
    case "contains":
      return `$contains(${path}, ${literal(r.value, r.valueKind)})`;
    case "empty":
      return `$not($exists(${path})) or ${path} = null or ${path} = ""`;
    case "notEmpty":
      return `$exists(${path}) and ${path} != null and ${path} != ""`;
  }
}

/**
 * Rows → the JSONata string. A row with no path contributes nothing (a
 * half-typed row stays local to the builder until it names its path).
 */
export function compileCondition(
  rows: ConditionRow[],
  combinator: "and" | "or",
): string {
  const parts: string[] = [];
  for (const r of rows) {
    if (!r.path.trim()) continue;
    const expr = rowExpr(r);
    if (expr) parts.push(expr);
  }
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const joiner = combinator === "or" ? " or " : " and ";
  return parts.map((p) => `(${p})`).join(joiner);
}

/** Top-level split on an `and`/`or` keyword (quote- and paren-aware). */
export function splitTop(expr: string, keyword: "and" | "or"): string[] | null {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      cur += ch;
      if (ch === inStr && expr[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")" || ch === "]") {
      depth--;
      cur += ch;
      continue;
    }
    if (
      depth === 0 &&
      (i === 0 || /\s/.test(expr[i - 1])) &&
      expr.slice(i).toLowerCase().startsWith(keyword) &&
      (i + keyword.length === expr.length || /\s/.test(expr[i + keyword.length]))
    ) {
      parts.push(cur);
      cur = "";
      i += keyword.length - 1;
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/**
 * The JSONata string → rows, when the expression is one the builder can
 * author (flat comparisons joined by a single combinator); null otherwise —
 * the caller keeps the raw box for it. Empty → an empty builder.
 */
export function decomposeCondition(
  expr: string | null,
): { rows: ConditionRow[]; combinator: "and" | "or" } | null {
  const s = (expr ?? "").trim();
  if (!s) return { rows: [], combinator: "and" };
  // the empty/not-empty ops compile to three-part chains — matched whole so
  // they round-trip as the single row the user authored (backreference \1
  // pins all three operands to the same path)
  const empty = /^\$not\(\$exists\((.+)\)\) or \1 = null or \1 = ""$/.exec(s);
  if (empty)
    return {
      rows: [{ path: empty[1].trim(), op: "empty", value: "", valueKind: "string" }],
      combinator: "and",
    };
  const notEmpty = /^\$exists\((.+)\) and \1 != null and \1 != ""$/.exec(s);
  if (notEmpty)
    return {
      rows: [
        { path: notEmpty[1].trim(), op: "notEmpty", value: "", valueKind: "string" },
      ],
      combinator: "and",
    };
  const andParts = splitTop(s, "and") ?? [];
  const orParts = splitTop(s, "or") ?? [];
  // both keywords present at top level (mixed precedence) → raw mode
  // (splitTop always returns at least [expr] in practice; ?? [] keeps the
  // no-keyword fallthrough on the `and` side without asserting)
  if (andParts.length > 1 && orParts.length > 1) return null;
  const combinator: "and" | "or" = orParts.length > 1 ? "or" : "and";
  const parts = combinator === "or" ? orParts : andParts;
  const rows: ConditionRow[] = [];
  for (const part of parts) {
    // one wrapping paren pair comes off (the builder's own compile adds them)
    let body = part.trim();
    if (body.startsWith("(") && body.endsWith(")")) body = body.slice(1, -1).trim();
    // the empty/not-empty chains matched per part too (they appear inside
    // multi-row compositions, wrapped in the builder's parens)
    const emptyPart = /^\$not\(\$exists\((.+)\)\) or \1 = null or \1 = ""$/.exec(body);
    if (emptyPart) {
      rows.push({
        path: emptyPart[1].trim(),
        op: "empty",
        value: "",
        valueKind: "string",
      });
      continue;
    }
    const notEmptyPart = /^\$exists\((.+)\) and \1 != null and \1 != ""$/.exec(body);
    if (notEmptyPart) {
      rows.push({
        path: notEmptyPart[1].trim(),
        op: "notEmpty",
        value: "",
        valueKind: "string",
      });
      continue;
    }
    const contains = /^\$contains\((.+), ?(.+)\)$/.exec(body);
    if (contains && isPath(contains[1].trim())) {
      const parsed = parseJsonataLiteral(contains[2]);
      if (!parsed) return null;
      rows.push({
        path: contains[1].trim(),
        op: "contains",
        value: parsed.value,
        valueKind: parsed.valueKind,
      });
      continue;
    }
    const cmp = /^(.+?) (>=|<=|!=|=|>|<) (.+)$/.exec(body);
    if (cmp) {
      // >= / <= exist in JSONata but not in the builder's ops — raw mode keeps them honest;
      // anything but a bare path on the left (function calls, arithmetic) → raw mode too
      if (cmp[2] === ">=" || cmp[2] === "<=" || !isPath(cmp[1].trim())) return null;
      const parsed = parseJsonataLiteral(cmp[3]);
      if (!parsed) return null;
      const op: ConditionOp =
        cmp[2] === "="
          ? "eq"
          : cmp[2] === "!="
            ? "ne"
            : cmp[2] === ">"
              ? "gt"
              : "lt";
      rows.push({
        path: cmp[1].trim(),
        op,
        value: parsed.value,
        valueKind: parsed.valueKind,
      });
      continue;
    }
    return null; // not builder-shaped (functions, paths, arithmetic) — raw mode
  }
  return { rows, combinator };
}

/** A bare variable path — letters, digits, `_`, `.`, `$` (wildcards go raw). */
function isPath(s: string): boolean {
  return /^[A-Za-z0-9_.$]+$/.test(s);
}
