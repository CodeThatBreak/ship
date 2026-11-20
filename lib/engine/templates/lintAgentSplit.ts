import "server-only";

import { db } from "../../db/app";
import { parseStartContract } from "../nodes/kinds/start/contract";
import { nodeRegistry } from "../nodes/registry";
import { resolveSplitTarget, type SplitTargetLookup } from "../nodes/shared/split";
import { schemaTypeOf } from "./utils/schemaTypeOf";
import { parseJsonObject } from "./utils/parseJsonObject";
import type { LintProblem } from "@/types/templateLint";

/**
 * The split-target lookup for the authoring checks — the same resolution the
 * runtime's `flowSplitTargetLookup` does (registry keys + node_templates rows
 * by id, then by catalog key with builtin rows excluded), inlined on raw SQL
 * so template-lint stays import-cycle free with the template store.
 */
const lintSplitTargetLookup: SplitTargetLookup = {
  isNodeKey: (key) => nodeRegistry.has(key),
  template: async (idOrKey) => {
    const byId = await db.get<{ id: string; isBuiltin: boolean }>(
          `SELECT id, is_builtin AS "isBuiltin" FROM node_templates WHERE id=$1`, idOrKey,
        );
    if (byId) return { id: byId.id };
    const byKey = await db.get<{ id: string; isBuiltin: boolean }>(
          `SELECT id, is_builtin AS "isBuiltin" FROM node_templates WHERE key=$1`, idOrKey,
        );
    return byKey && !byKey.isBuiltin ? { id: byKey.id } : null;
  },
};

/**
 * The agent def's split authoring checks (agent-node split plan §2.2/§2.3):
 * `field` must be a top-level ARRAY in the def's output_schema (a unit source
 * iterates an array), the per-item paths must resolve in the array's element
 * shape, and the default target must resolve as a node key or a node template
 * whose start contract accepts the item's declared shape (strictly — the same
 * key-set semantics the runtime's `assertSplitTargetCompatible` enforces on
 * the concrete item). Every check free-passes when it can't know (no output
 * schema, permissive element shape) — the runtime re-checks with real data.
 */
export const lintAgentSplit = async (
  cfg: Record<string, unknown>,
  where: string,
  nodeKey: string,
  problems: LintProblem[],
): Promise<void> => {
  const split = cfg.split;
  if (!split || typeof split !== "object" || Array.isArray(split)) return;
  const s = split as Record<string, unknown>;
  const stamp = { nodeKey };
  const problem = (message: string) => problems.push({ where, message, ...stamp });

  if (cfg.output !== "json") {
    problem("split publishes units from the json output — set output to json (a markdown agent has no array to iterate)");
    return;
  }
  const schema = cfg.output_schema && typeof cfg.output_schema === "object" && !Array.isArray(cfg.output_schema)
    ? (cfg.output_schema as { properties?: Record<string, unknown> })
    : null;

  // the element-shape keys of split.field (null = unknown → the path checks
  // and the target compat check free-pass)
  let elementKeys: string[] | null = null;
  if (schema?.properties) {
    const field = typeof s.field === "string" ? s.field : "";
    if (!field) {
      problem("split.field is required when split is declared");
    } else {
      const item = schema.properties[field];
      if (item == null) {
        problem(`split.field "${field}" is not declared in the output schema`);
      } else if (schemaTypeOf(item) !== "array") {
        problem(`split.field "${field}" must be an array in the output schema — a unit source iterates an array`);
      } else {
        const elementProps = item && typeof item === "object"
          ? (item as { items?: { properties?: Record<string, unknown> } }).items?.properties
          : undefined;
        if (elementProps && Object.keys(elementProps).length) {
          elementKeys = Object.keys(elementProps);
          // the per-item paths (defaults = the schema's, per AgentDefSchema)
          for (const [key, fallback, what] of [
            ["key_field", "key", "the stable unit id"],
            ["depends_on_field", "dependsOn", "the unit keys units wait for"],
            ["target_field", "", "the per-item target override"],
          ] as const) {
            const v = s[key];
            const effective = typeof v === "string" && v.trim() ? v : fallback;
            if (effective && !elementKeys.includes(effective)) {
              problem(
                `split.${key} "${effective}" (${what}) is not a field of the "${field}" items — element fields: ${elementKeys.join(", ")}`,
              );
            }
          }
        }
      }
    }
  }

  // the default target: resolution (node key / template id) + compatibility
  const target = typeof s.target === "string" && s.target.trim() ? s.target.trim() : null;
  if (target) {
    try {
      const resolved = await resolveSplitTarget(target, lintSplitTargetLookup);
      if (resolved.kind === "template" && elementKeys != null) {
        const configRow = await db.get<{ config: unknown }>(
                  `SELECT config FROM node_templates WHERE id=$1`, resolved.id,
                );
        const fields = parseStartContract(parseJsonObject(configRow?.config));
        if (fields.length) {
          const missing = fields.filter((f) => f.required && !elementKeys.includes(f.key)).map((f) => f.key);
          if (missing.length) {
            problem(`the unit items don't declare ${JSON.stringify(missing)} — required by the target template "${resolved.id}" start contract`);
          }
          const extra = elementKeys.filter((k) => !fields.some((f) => f.key === k));
          if (extra.length) {
            problem(`the unit items declare fields outside the target template "${resolved.id}" start contract (strict shape): ${extra.join(", ")}`);
          }
        }
      }
    } catch (e: unknown) {
      problem(e instanceof Error ? e.message : String(e));
    }
  }
};
