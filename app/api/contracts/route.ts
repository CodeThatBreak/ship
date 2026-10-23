import { NextResponse } from "next/server";
import { z } from "zod";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";
import { templateStore } from "../../../lib/engine/templates";

export const dynamic = "force-dynamic";

/**
 * A node's contract for the configurator (§5): declared input fields, output
 * schema, and config knobs (schema for display + fields for the auto form).
 * `def` is a built-in registry key or a node_templates row id.
 */
export async function GET(req: Request) {
  const defKey = new URL(req.url).searchParams.get("def") ?? "";
  if (!defKey) return NextResponse.json({ error: "def required" }, { status: 400 });

  const builtin = nodeRegistry.maybe(defKey);
  if (builtin) {
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

  if (nt.kind === "agent") {
    const def = nodeRegistry.resolve(nt.id);
    return NextResponse.json(agentContract(def as never, nt));
  }
  return NextResponse.json({ error: `unknown node type (${nt.kind} ships with Phase 3)` }, { status: 404 });
}

function agentContract(
  def: {
    inputSchema: z.ZodTypeAny;
    def: { inputs: { key: string; label?: string; type?: string; required?: boolean }[]; output: string; output_schema: unknown };
  },
  nt: { id: string; key: string; name: string; kind: string },
) {
  return {
    key: nt.id,
    catalogKey: nt.key,
    label: nt.name,
    kind: nt.kind,
    input: z.toJSONSchema(def.inputSchema),
    output: def.def.output === "json" && def.def.output_schema
      ? def.def.output_schema
      : { type: "object", properties: { markdown: { type: "string", description: "Agent output, saved as an artifact" } }, required: ["markdown"] },
    config: {
      fields: [
        { key: "prompt", label: "Prompt", type: "text", help: "PromptLibrary-style {{vars}}: ticket.*, flow.*, repo.*, nodes.<key>.output.*" },
        { key: "mode", label: "Mode", type: "select", options: [{ value: "plan", label: "plan (read-only)" }, { value: "agent", label: "agent (repo workspace)" }] },
        { key: "model", label: "Model", type: "string", help: "Empty = flow/default model" },
      ],
      defaults: (def as unknown as { def: Record<string, unknown> }).def,
      schema: { type: "object" },
    },
  };
}
