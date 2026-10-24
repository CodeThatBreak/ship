import { NextResponse } from "next/server";
import { z } from "zod";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";
import { templateStore } from "../../../lib/engine/templates";
import {
  parseStartContract,
  startContractJsonSchema,
} from "../../../lib/engine/nodes/start/contract";

export const dynamic = "force-dynamic";

/**
 * A node's contract for the configurator (§5): declared input fields, output
 * schema, and config knobs (schema for display + fields for the auto form).
 * `def` is a built-in registry key or a node_templates row id.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const defKey = url.searchParams.get("def") ?? "";
  if (!defKey) return NextResponse.json({ error: "def required" }, { status: 400 });
  // optional instance config (the start node's contract is per instance, not
  // per catalog row) — {contract: [...]} turns into the input/output schemas
  let instanceConfig: unknown = null;
  const rawConfig = url.searchParams.get("config");
  if (rawConfig) {
    try { instanceConfig = JSON.parse(rawConfig); } catch { instanceConfig = null; }
  }

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
      config: {
        fields: builtin.configFields,
        defaults: builtin.defaultConfig(),
        schema: z.toJSONSchema(builtin.configSchema),
      },
    });
  }

  const nt =
    templateStore.nodeTemplate(defKey) ??
    templateStore.listNodeTemplates().find((r) => !r.is_builtin && r.key === defKey);
  if (!nt) return NextResponse.json({ error: "unknown node type" }, { status: 404 });

  // declarative kinds (agent / decision / http / script): the runtime class
  // carries the parsed definition + config fields; the output contract is
  // derived per kind (§5 — the configurator's Contract tab). The instance
  // config participates: the drawer authors output schemas / choices as
  // instance overrides, and downstream nodes must see the merged run context
  // — the catalog-only def would hide the fields an instance override adds.
  const def = nodeRegistry.resolve(nt.id) as unknown as {
    inputSchema: z.ZodTypeAny;
    def: Record<string, unknown>;
    configFields: unknown[];
  };
  // The instance config participates: the drawer authors output schemas /
  // choices as instance overrides, and downstream nodes must see the merged
  // run context — the catalog-only def would hide the fields an override adds.
  const overrides =
    instanceConfig && typeof instanceConfig === "object" && !Array.isArray(instanceConfig)
      ? (instanceConfig as Record<string, unknown>)
      : {};
  const mergedDef = { ...def.def, ...overrides } as Record<string, unknown>;
  return NextResponse.json({
    key: nt.id,
    catalogKey: nt.key,
    label: nt.name,
    kind: nt.kind,
    input: z.toJSONSchema(def.inputSchema),
    output: declarativeOutputContract(nt.kind, mergedDef),
    choices: nt.kind === "decision" ? decisionChoices(mergedDef) : undefined,
    config: {
      fields: def.configFields,
      defaults: mergedDef,
      schema: { type: "object" },
    },
  });
}

/** The addressable output fields per declarative kind (configurator Contract tab). */
function declarativeOutputContract(kind: string, def: Record<string, unknown>): unknown {
  switch (kind) {
    case "agent":
      return def.output === "json" && def.output_schema
        ? def.output_schema
        : { type: "object", properties: { markdown: { type: "string", description: "Agent output, saved as an artifact" } }, required: ["markdown"] };
    case "decision":
      return {
        type: "object",
        properties: decisionOutputProperties(def),
        required: ["chosen"],
      };
    case "http":
      return {
        type: "object",
        description: "Default contract — response_map may reshape it",
        properties: {
          status: { type: "number" },
          ok: { type: "boolean" },
          body: {},
          headers: { type: "object" },
        },
      };
    case "script":
      return def.output_schema && typeof def.output_schema === "object"
        ? def.output_schema
        : { type: "object", description: "Free-form JSON object (declare an output schema to constrain it)" };
    default:
      return { type: "object" };
  }
}

/** A decision node's choices for the configurator / decision card. */
function decisionChoices(def: Record<string, unknown>): { label: string; description?: string; condition?: string }[] {
  const choices = def.choices;
  if (!Array.isArray(choices)) return [];
  return choices
    .filter((c): c is { label: string; description?: string; condition?: string } =>
      !!c && typeof c === "object" && typeof (c as { label?: unknown }).label === "string")
    .map((c) => ({
      label: c.label,
      description: typeof c.description === "string" ? c.description : undefined,
      condition: typeof c.condition === "string" ? c.condition : undefined,
    }));
}

/** The decision's published output fields: chosen / rationale + the pass-down
 *  variables (each maps a field name → a JSONata expression over the flow
 *  context). Downstream nodes' variable chips read from this. */
function decisionOutputProperties(def: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {
    chosen: { type: "array", items: { type: "string" }, description: "The picked branch labels" },
    rationale: { type: "string" },
  };
  const pass = def.pass;
  if (pass && typeof pass === "object" && !Array.isArray(pass)) {
    for (const [field, expr] of Object.entries(pass as Record<string, unknown>)) {
      if (field.trim() && typeof expr === "string" && expr.trim()) {
        props[field.trim()] = { description: `passed downstream — ${expr.trim()}` };
      }
    }
  }
  return props;
}
