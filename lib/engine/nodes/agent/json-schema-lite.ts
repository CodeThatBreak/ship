/**
 * A minimal JSON Schema validator for the parts of the schema that declarative
 * node configs use: object {properties, required}, array {items}, primitives
 * with min/max, enum. Nothing recursive-beyond-structure or format-dependent —
 * agent outputs are small structured payloads, and anything richer should sit
 * behind an artifact, not inline node output.
 *
 * Throws an Error carrying the offending path — node runs fail loudly
 * (§5: "persist time" validation) and the failure surfaces to the user.
 */
export function validateJsonSchema(schema: unknown, value: unknown, label: string): void {
  check(schema, value, label, [], false);
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

function check(schema: unknown, value: unknown, label: string, path: string[], strict: boolean): void {
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
      throw new Error(`${at} must be one of: ${s.enum.map((v) => JSON.stringify(v)).join(", ")}`);
    }
  }

  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const actual = typeOf(value);
    if (!types.some((t) => typeMatches(t, actual))) {
      throw new Error(`${at} must be of type ${types.join("|")} (got ${actual})`);
    }
  }

  if (typeof value === "string") {
    if (s.minLength != null && value.length < s.minLength) throw new Error(`${at} is shorter than ${s.minLength} characters`);
    if (s.maxLength != null && value.length > s.maxLength) throw new Error(`${at} is longer than ${s.maxLength} characters`);
  }
  if (typeof value === "number") {
    if (s.minimum != null && value < s.minimum) throw new Error(`${at} must be >= ${s.minimum}`);
    if (s.maximum != null && value > s.maximum) throw new Error(`${at} must be <= ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems != null && value.length < s.minItems) throw new Error(`${at} must have at least ${s.minItems} items`);
    if (s.maxItems != null && value.length > s.maxItems) throw new Error(`${at} must have at most ${s.maxItems} items`);
    if (s.items != null) {
      value.forEach((item, i) => check(s.items, item, label, [...path, String(i)], strict));
    }
  }
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) {
      if (!(key in obj)) throw new Error(`${at} is missing required property "${key}"`);
    }
    if (s.properties) {
      for (const [key, sub] of Object.entries(s.properties)) {
        if (key in obj) check(sub, obj[key], label, [...path, key], strict);
      }
      const extras = Object.keys(obj).filter((k) => !(k in (s.properties ?? {})));
      // unknown fields are tolerated (agents add context) unless the schema forbids them
      if (extras.length && s.additionalProperties === false) {
        throw new Error(`${at} has unexpected properties: ${extras.join(", ")}`);
      }
    }
  }
}

/**
 * Pull the JSON payload out of an agent's free-text answer: a bare JSON body,
 * a ```json fenced block, or the first balanced {...} / [...] region.
 * Returns null when nothing parseable is found.
 */
export function extractJson(text: string): unknown {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* keep trying */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* keep trying */
    }
  }
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* give up */
      }
    }
  }
  return null;
}
