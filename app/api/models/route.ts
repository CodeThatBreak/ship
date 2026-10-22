import { NextResponse } from "next/server";
import { LocalAgentService, localAgent } from "../../../lib/integrations/localAgent";
import { db } from "../../../lib/db";
import { config } from "../../../lib/config";
import { parseModelSpec, type CatalogModel } from "../../../lib/modelSpec";

export const dynamic = "force-dynamic";

/**
 * Models available for agent runs — from the account model catalog, with a
 * static fallback. The catalog is normalized here so consumers get structured
 * data directly and never see the SDK's variant-combo ids:
 * - one row per base model; the bare entry is authoritative, bracketed ids
 *   ("composer-2.5[fast=false]") only fill gaps;
 * - "default"/"auto" is folded into `default` (the account default model).
 * `models` stays a flat id list for older consumers.
 */
export async function GET() {
  const raw = new Map<string, CatalogModel>();
  const bracketed: { m: CatalogModel; id: string; params: Record<string, string> }[] = [];

  const catalog = (await localAgent.listCatalog()) ?? [];
  for (const m of catalog) {
    const parsed = parseModelSpec(m.id);
    const id = parsed?.id ?? m.id;
    if (id === "default" || id === "auto") continue; // covered by `default`
    if (parsed?.params?.length) {
      bracketed.push({
        m,
        id,
        params: Object.fromEntries(parsed.params.map((p) => [p.id, p.value])),
      });
    } else if (!raw.has(id)) {
      raw.set(id, { ...m, id });
    }
  }
  // pass 2: no bare sibling — synthesize a clean base entry from the spec
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
  const models = catalogList.length
    ? catalogList.map((m) => m.id)
    : [...LocalAgentService.FALLBACK_MODELS];
  const currentDefault = db.getSetting<string>("default_model", "") || config.cursor.defaultModel() || "";
  // Resolve the configured default (may be a spec like "composer-2.5[fast=false]")
  // into structured data so consumers never touch bracket strings.
  const parsedDefault = parseModelSpec(currentDefault);
  const defaultChoice = parsedDefault
    ? {
        id: parsedDefault.id,
        params: Object.fromEntries((parsedDefault.params ?? []).map((p) => [p.id, p.value])),
      }
    : null;
  // Make sure the configured default is always selectable even if the catalog
  // doesn't list it (e.g. an alias or a newly released model).
  const known = new Set(models);
  if (defaultChoice?.id && !known.has(defaultChoice.id)) {
    models.unshift(defaultChoice.id);
    catalogList.unshift({
      id: defaultChoice.id,
      displayName: defaultChoice.id.replace(/\[.*\]$/, "") || defaultChoice.id,
      aliases: [],
      parameters: defaultChoice.params && Object.entries(defaultChoice.params).length
        ? Object.entries(defaultChoice.params).map(([id, value]) => ({
            id,
            values: [{ value }, { value: value === "true" ? "false" : "true" }],
          }))
        : [],
      variants: [],
    });
  }
  return NextResponse.json({
    models,
    catalog: catalogList,
    source,
    default: defaultChoice?.id ?? null,
    defaultChoice,
  });
}
