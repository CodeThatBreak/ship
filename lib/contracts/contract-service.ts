import "server-only";

import { z } from "zod";
import { nodeRegistry } from "@/lib/engine/nodes/registry";
import { NodeDefinition } from "@/lib/engine/nodes/shared";
import { templateStore } from "@/lib/engine/templates/template-store";
import { prompts } from "@/lib/engine/prompts/prompt-library";
import { instantiateDeclarative, type DeclarativeRow } from "@/lib/engine/nodes/declarative";
import {
  parseStartContract,
  startContractJsonSchema,
} from "@/lib/engine/nodes/kinds/start/contract";

export const contractParamsSchema = z.object({
  def: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type ContractParams = z.infer<typeof contractParamsSchema>;

const promptSections = (keys: readonly string[]) =>
  keys
    .map((key) => {
      const parts = prompts.templateParts(key);
      return parts ? { key, ...parts } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s != null);

export class ContractService {
  resolve(params: ContractParams): Response {
    const defKey = params.def ?? "";
    const kindParam = params.kind ?? "";
    if (!defKey && !kindParam) {
      return Response.json({ error: "def or kind required" }, { status: 400 });
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
          return Response.json({
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
        return Response.json({
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
      if (!nt) return Response.json({ error: "unknown node type" }, { status: 404 });
      row = {
        id: nt.id,
        name: nt.name,
        description: nt.description,
        kind: nt.kind,
        config: nt.config,
      };
      catalogKey = nt.key;
    }
    const inst = (() => {
      try {
        return instantiateDeclarative(row);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    })();
    if (!(inst instanceof NodeDefinition)) {
      return Response.json(
        {
          error:
            typeof inst === "string" ? `invalid node definition: ${inst}` : "unknown node type",
        },
        { status: typeof inst === "string" ? 400 : 404 },
      );
    }
    const overrides = instanceConfig ?? {};
    const baseConfig =
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : {};
    const mergedDef = { ...baseConfig, ...overrides };
    return Response.json({
      key: row.id,
      catalogKey,
      label: row.name,
      kind: row.kind,
      input: z.toJSONSchema(inst.inputSchema),
      output: inst.outputContract(mergedDef),
      choices: inst.choices(mergedDef) ?? undefined,
      capabilities: inst.capabilities,
      config: {
        fields: inst.configFields,
        defaults: mergedDef,
        schema: z.toJSONSchema(inst.configSchema),
      },
    });
  }
}
