import { NextResponse } from "next/server";
import { z } from "zod";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";
import { templateStore } from "../../../lib/engine/templates/template-store";
import { prompts } from "../../../lib/engine/prompts/prompt-library";
import { instantiateDeclarative, type DeclarativeRow } from "../../../lib/engine/nodes/declarative";
import {
  parseStartContract,
  startContractJsonSchema,
} from "../../../lib/engine/nodes/kinds/start/contract";
import type { NodeCapabilities } from "../../../lib/engine/nodes/shared/capabilities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const contractParamsSchema = z.object({
  def: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type ContractParams = z.infer<typeof contractParamsSchema>;

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

function resolveNodeContract(params: ContractParams) {
  const defKey = params.def ?? "";
  const kindParam = params.kind ?? "";
  if (!defKey && !kindParam) {
    return NextResponse.json({ error: "def or kind required" }, { status: 400 });
  }

  const instanceConfig =
    params.config && typeof params.config === "object" && !Array.isArray(params.config)
      ? params.config
      : null;

  if (!kindParam) {
    const builtin =
      nodeRegistry.maybe(defKey) ??
      (() => {
        const row = templateStore.nodeTemplate(defKey);
        return row?.is_builtin ? nodeRegistry.maybe(row.key) : undefined;
      })();
    if (builtin) {
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

  let row: DeclarativeRow;
  let catalogKey: string | undefined;
  if (kindParam) {
    row = {
      id: defKey || "draft",
      name: params.name ?? kindParam,
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
  const overrides = instanceConfig ?? {};
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

/**
 * A node's contract for the configurator (§5): declared input fields, output
 * schema, and config knobs (schema for display + fields for the auto form).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const defKey = url.searchParams.get("def") ?? "";
  const kindParam = url.searchParams.get("kind") ?? "";
  let instanceConfig: Record<string, unknown> | null = null;
  const rawConfig = url.searchParams.get("config");
  if (rawConfig) {
    try {
      const parsed: unknown = JSON.parse(rawConfig);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        instanceConfig = parsed as Record<string, unknown>;
      }
    } catch {
      instanceConfig = null;
    }
  }
  return resolveNodeContract({
    def: defKey || undefined,
    kind: kindParam || undefined,
    name: url.searchParams.get("name") ?? undefined,
    config: instanceConfig,
  });
}

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = contractParamsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid contract request" }, { status: 400 });
  }
  return resolveNodeContract(parsed.data);
}
