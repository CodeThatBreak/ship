import { NextResponse } from "next/server";
import { z } from "zod";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";
import { templateStore } from "../../../lib/engine/templates/template-store";
import { prompts } from "../../../lib/engine/prompts/prompt-library";
import { instantiateDeclarative, type DeclarativeRow } from "../../../lib/engine/nodes/declarative";
import {
  parseStartContract,
  startContractJsonSchema,
} from "../../../lib/engine/nodes/start/contract";
import type { NodeCapabilities } from "../../../lib/engine/nodes/base/capabilities";

export const dynamic = "force-dynamic";

/**
 * The def's prompt templates as unrendered three-part sections (body / locked
 * rules / locked output contract) — the configurator's Prompt tab. One entry
 * per `promptSections` key; nulls dropped defensively.
 */
function promptSections(keys: readonly string[]) {
  return keys
    .map((key) => {
      const parts = prompts.templateParts(key);
      return parts ? { key, ...parts } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s != null);
}

/**
 * A node's contract for the configurator (§5): declared input fields, output
 * schema, and config knobs (schema for display + fields for the auto form).
 * `def` is a built-in registry key or a node_templates row id. Draft instances
 * (Phase 2 — palette tiles place `draft:<n>` instances with no row until Save)
 * pass `kind=agent&config={…}` instead: the declarative runtime class is
 * instantiated against a synthetic row, no catalog row involved.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const defKey = url.searchParams.get("def") ?? "";
  const kindParam = url.searchParams.get("kind") ?? "";
  if (!defKey && !kindParam) {
    return NextResponse.json({ error: "def or kind required" }, { status: 400 });
  }
  // optional instance config (the start node's contract is per instance, not
  // per catalog row) — {contract: [...]} turns into the input/output schemas
  let instanceConfig: unknown = null;
  const rawConfig = url.searchParams.get("config");
  if (rawConfig) {
    try { instanceConfig = JSON.parse(rawConfig); } catch { instanceConfig = null; }
  }

  if (!kindParam) {
    const builtin =
      // built-ins resolve by registry key ("plan") …
      nodeRegistry.maybe(defKey) ??
      // … or through a node_templates row id ("nt_plan") → the row's key
      (() => {
        const row = templateStore.nodeTemplate(defKey);
        return row?.is_builtin ? nodeRegistry.maybe(row.key) : undefined;
      })();
    if (builtin) {
      // start node with a declared contract: the fields ARE the input/output
      // contract (who provides the values follows the node's trigger type)
      const startFields = builtin.key === "start" ? parseStartContract(instanceConfig) : [];
      if (startFields.length) {
        const schema = startContractJsonSchema(startFields);
        return NextResponse.json({
          key: builtin.key,
          label: builtin.label,
          kind: "builtin",
          input: schema,
          output: schema,
          capabilities: builtin.capabilities,
          prompt: promptSections(builtin.promptSections),
          config: {
            fields: builtin.configFields,
            defaults: builtin.defaultConfig(),
            schema: z.toJSONSchema(builtin.configSchema),
          },
        });
      }
      return NextResponse.json({
        key: builtin.key,
        label: builtin.label,
        kind: "builtin",
        input: z.toJSONSchema(builtin.inputSchema),
        output: z.toJSONSchema(builtin.outputSchema),
        capabilities: builtin.capabilities,
        prompt: promptSections(builtin.promptSections),
        config: {
          fields: builtin.configFields,
          defaults: builtin.defaultConfig(),
          schema: z.toJSONSchema(builtin.configSchema),
        },
      });
    }
  }

  // declarative kinds (agent / decision / http / script): the runtime class
  // carries the parsed definition + config fields, and owns its output
  // contract / choices (§5 — the configurator's Contract tab). Row-backed
  // (`def=nt_…`) or synthesized (`kind=agent` — draft instances, Phase 2).
  let row: DeclarativeRow;
  let catalogKey: string | undefined;
  if (kindParam) {
    row = {
      id: defKey || "draft",
      name: url.searchParams.get("name") ?? kindParam,
      description: null,
      kind: kindParam,
      config: instanceConfig ?? {},
    };
  } else {
    const nt =
      templateStore.nodeTemplate(defKey) ??
      templateStore.listNodeTemplates().find((r) => !r.is_builtin && r.key === defKey);
    if (!nt) return NextResponse.json({ error: "unknown node type" }, { status: 404 });
    row = { id: nt.id, name: nt.name, description: nt.description, kind: nt.kind, config: nt.config };
    catalogKey = nt.key;
  }
  const inst = (() => {
    try {
      return instantiateDeclarative(row);
    } catch (e) {
      // unreadable definition (e.g. a decision without choices) — a readable
      // 400, not an unhandled 500
      return e instanceof Error ? e.message : String(e);
    }
  })();
  if (!inst || typeof inst !== "object") {
    return NextResponse.json(
      { error: typeof inst === "string" ? `invalid node definition: ${inst}` : "unknown node type" },
      { status: typeof inst === "string" ? 400 : 404 },
    );
  }
  const typed = inst as unknown as {
    def: Record<string, unknown>;
    configFields: unknown[];
    outputContract(def?: Record<string, unknown>): unknown;
    choices(def?: Record<string, unknown>): { label: string; description?: string; condition?: string }[] | null;
    capabilities: NodeCapabilities;
  };
  // The instance config participates: the drawer authors output schemas /
  // choices as instance overrides, and downstream nodes must see the merged run
  // context — the catalog-only def would hide the fields an override adds.
  const overrides =
    instanceConfig && typeof instanceConfig === "object" && !Array.isArray(instanceConfig)
      ? (instanceConfig as Record<string, unknown>)
      : {};
  const mergedDef = { ...typed.def, ...overrides } as Record<string, unknown>;
  return NextResponse.json({
    key: row.id,
    catalogKey,
    label: row.name,
    kind: row.kind,
    input: z.toJSONSchema((inst as unknown as { inputSchema: z.ZodTypeAny }).inputSchema),
    output: typed.outputContract(mergedDef),
    choices: typed.choices(mergedDef) ?? undefined,
    capabilities: typed.capabilities,
    config: {
      fields: typed.configFields,
      defaults: mergedDef,
      schema: { type: "object" },
    },
  });
}
