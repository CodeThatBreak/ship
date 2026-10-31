import "server-only";

/**
 * A minimal JSON Schema validator for the parts of the schema that declarative
 * node configs use: object {properties, required}, array {items}, primitives
 * with min/max, enum. Nothing recursive-beyond-structure or format-dependent —
 * agent outputs are small structured payloads, and anything richer should sit
 * behind an artifact, not inline node output.
 *
 * `jsonSchemaIssues` returns every violation as structured issues (empty =
 * valid) so the standard output-error payload can carry them all; the
 * throwing `validateJsonSchema` is a thin wrapper over it for callers that
 * only want the loud failure.
 */
import type { AgentOutputIssue } from "../../shared/agent/outputError/outputErrorExports";

export { extractJson } from "../../shared/extractJson";

export function validateJsonSchema(schema: unknown, value: unknown, label: string): void {
  const issues = jsonSchemaIssues(schema, value, label);
  if (issues.length) throw new Error(issues[0].message);
}

/**
 * Validate a value against a JSON Schema, collecting every violation (not
 * just the first) as `{path, message}` issues — [] means valid. A missing or
 * non-object schema still throws: that is an authoring error in the node's
 * config, not an agent-response failure.
 */
export function jsonSchemaIssues(schema: unknown, value: unknown, label: string): AgentOutputIssue[] {
  const issues: AgentOutputIssue[] = [];
  check(schema, value, label, [], false, issues);
  return issues;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === "number" && actual === "integer");
}

function check(schema: unknown, value: unknown, label: string, path: string[], strict: boolean, issues: AgentOutputIssue[]): void {
  const add = (message: string) => issues.push({ path: path.join("."), message });
  const at = path.length ? `${label} at ${path.join(".")}` : label;
  if (schema === true) return;
  if (schema == null || schema === false) {
    throw new Error(`${label}: invalid output schema (missing)`);
  }
  if (typeof schema !== "object") {
    throw new Error(`${label}: invalid output schema`);
  }
  const s = schema as {
    type?: string | string[];
    enum?: unknown[];
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    additionalProperties?: unknown;
  };

  if (Array.isArray(s.enum)) {
    if (!s.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
      add(`${at} must be one of: ${s.enum.map((v) => JSON.stringify(v)).join(", ")}`);
      return;
    }
  }

  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const actual = typeOf(value);
    if (!types.some((t) => typeMatches(t, actual))) {
      // return: deeper checks against a mismatched type only cascade
      add(`${at} must be of type ${types.join("|")} (got ${actual})`);
      return;
    }
  }

  if (typeof value === "string") {
    if (s.minLength != null && value.length < s.minLength) add(`${at} is shorter than ${s.minLength} characters`);
    if (s.maxLength != null && value.length > s.maxLength) add(`${at} is longer than ${s.maxLength} characters`);
  }
  if (typeof value === "number") {
    if (s.minimum != null && value < s.minimum) add(`${at} must be >= ${s.minimum}`);
    if (s.maximum != null && value > s.maximum) add(`${at} must be <= ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems != null && value.length < s.minItems) add(`${at} must have at least ${s.minItems} items`);
    if (s.maxItems != null && value.length > s.maxItems) add(`${at} must have at most ${s.maxItems} items`);
    if (s.items != null) {
      value.forEach((item, i) => check(s.items, item, label, [...path, String(i)], strict, issues));
    }
  }
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) {
      if (!(key in obj)) add(`${at} is missing required property "${key}"`);
    }
    if (s.properties) {
      for (const [key, sub] of Object.entries(s.properties)) {
        if (key in obj) check(sub, obj[key], label, [...path, key], strict, issues);
      }
      const extras = Object.keys(obj).filter((k) => !(k in (s.properties ?? {})));
      // unknown fields are tolerated (agents add context) unless the schema forbids them
      if (extras.length && s.additionalProperties === false) {
        add(`${at} has unexpected properties: ${extras.join(", ")}`);
      }
    }
  }
}
