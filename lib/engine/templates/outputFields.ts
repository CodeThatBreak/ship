import "server-only";

import { parseStartContract } from "../nodes/kinds/start/contract";

/** The output contract (addressable fields) a definition publishes. Shared
 *  with the graph API so the canvas can show the same variables. */
export const outputFieldsFor = (kind: string, config: unknown): string[] | null => {
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
};
