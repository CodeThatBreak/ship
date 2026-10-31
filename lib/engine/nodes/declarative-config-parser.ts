import "server-only";

import {
  AgentDefSchema,
  DecisionDefSchema,
  HttpDefSchema,
  ScriptDefSchema,
} from "./declarative-schemas";

/** Parse a kind's declarative config, throwing the first problem as a readable Error. */
export const parseDeclarativeConfig = (
  kind: string,
  config: unknown,
  name = "node",
): Record<string, unknown> => {
  const label = `${name} (${kind})`;
  try {
    switch (kind) {
      case "agent":
        return AgentDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      case "decision":
        return DecisionDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      case "http":
        return HttpDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      case "script":
        return ScriptDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      default:
        throw new Error(`unknown declarative kind "${kind}"`);
    }
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e) {
      const zodErr = e as { issues: { path: (string | number)[]; message: string }[] };
      const first = zodErr.issues[0];
      if (first) {
        const at = first.path.length ? ` "${label}.${first.path.join(".")}"` : ` for ${label}`;
        throw new Error(`invalid config${at}: ${first.message}`);
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
};
