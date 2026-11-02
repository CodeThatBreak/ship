import "server-only";

import { FAST_ON, FAST_PARAM } from "@/constants/models";
import { agentPortRegistry, type AgentPortRegistry } from "../engine/ports/agentPort";
import { parseModelSpec, type CatalogModel } from "../modelSpec";
import { settingsService } from "../settings/settingsService";
import { processSingleton } from "../singleton";

const isNoiseFastParam = (p: { id: string; value: string }): boolean =>
  p.id === FAST_PARAM && p.value !== FAST_ON;

export type ModelCatalogPayload = {
  models: string[];
  catalog: CatalogModel[];
  source: "catalog" | "fallback";
  default: string | null;
  defaultChoice: { id: string; params: Record<string, string> } | null;
};

export class ModelCatalogService {
  constructor(private readonly agentPorts: AgentPortRegistry) {}

  async normalized(): Promise<ModelCatalogPayload> {
    const port = this.agentPorts.forMode("local");
    const raw = new Map<string, CatalogModel>();
    const bracketed: { m: CatalogModel; id: string; params: Record<string, string> }[] = [];

    const catalog = (await port.listCatalog()) ?? [];
    for (const m of catalog) {
      const parsed = parseModelSpec(m.id);
      const id = parsed?.id ?? m.id;
      if (id === "default" || id === "auto") continue;
      const params = Object.fromEntries(
        (parsed?.params ?? []).filter((p) => !isNoiseFastParam(p)).map((p) => [p.id, p.value]),
      );
      if (Object.keys(params).length) {
        bracketed.push({ m, id, params });
      } else if (!raw.has(id)) {
        raw.set(id, { ...m, id });
      }
    }
    for (const { m, id, params } of bracketed) {
      if (raw.has(id)) continue;
      raw.set(id, {
        ...m,
        id,
        displayName: m.displayName.replace(/\[.*\]$/, "") || id,
        parameters: Object.entries(params).map(([k, v]) => ({
          id: k,
          values: [{ value: v }, { value: v === "true" ? "false" : "true" }],
        })),
        variants: [],
      });
    }

    const catalogList = [...raw.values()];
    const source = catalogList.length ? "catalog" : "fallback";
    const models = catalogList.length ? catalogList.map((m) => m.id) : [...port.fallbackModels];
    const currentDefault = this.defaultModelSpec();
    const parsedDefault = parseModelSpec(currentDefault);
    const defaultChoice = parsedDefault
      ? {
          id: parsedDefault.id,
          params: Object.fromEntries(
            (parsedDefault.params ?? [])
              .filter((p) => !isNoiseFastParam(p))
              .map((p) => [p.id, p.value]),
          ),
        }
      : null;
    const known = new Set(models);
    if (defaultChoice?.id && !known.has(defaultChoice.id)) {
      models.unshift(defaultChoice.id);
      catalogList.unshift({
        id: defaultChoice.id,
        displayName: defaultChoice.id.replace(/\[.*\]$/, "") || defaultChoice.id,
        aliases: [],
        parameters:
          defaultChoice.params && Object.entries(defaultChoice.params).length
            ? Object.entries(defaultChoice.params).map(([id, value]) => ({
                id,
                values: [{ value }, { value: value === "true" ? "false" : "true" }],
              }))
            : [],
        variants: [],
      });
    }
    return {
      models,
      catalog: catalogList,
      source,
      default: defaultChoice?.id ?? null,
      defaultChoice,
    };
  }

  defaultModelSpec(): string {
    return settingsService.defaultModel();
  }
}

export const modelCatalogService = processSingleton(
  "modelCatalogService",
  () => new ModelCatalogService(agentPortRegistry),
);
