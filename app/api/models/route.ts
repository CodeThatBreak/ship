import { NextResponse } from "next/server";
import { agentPortRegistry } from "../../../lib/engine/ports/agent-runner";
import { db } from "../../../lib/db";
import { config } from "../../../lib/config";
import { FAST_ON, FAST_PARAM } from "../../../constants/models";
import { normalizeModelSpec, parseModelSpec, type CatalogModel } from "../../../lib/modelSpec";

export const dynamic = "force-dynamic";

/**
 * `fast` values are display noise on the picker-side catalog: DevFlow runs
 * pin fast=false on the wire (CursorAgentService.pinFastOff — an unstated
 * `fast` falls through to the account default variant, fast=true for composer
 * models), and the picker's Fast switch defaults from the variant seed. Only
 * an explicit fast opt-in survives, so consumers never see a fast=false param
 * here.
 */
const isNoiseFastParam = (p: { id: string; value: string }): boolean =>
  p.id === FAST_PARAM && p.value !== FAST_ON;

/**
 * Models available for agent runs — from the account model catalog, with a
 * static fallback. The catalog is normalized here so consumers get structured
 * data directly and never see the SDK's variant-combo ids:
 * - one row per base model; the bare entry is authoritative, bracketed ids
 *   ("composer-2.5[effort=high]") only fill gaps (non-opt-in `fast` params
 *   are dropped — DevFlow runs fix fast off on the wire);
 * - "default"/"auto" is folded into `default` (the account default model).
 * `models` stays a flat id list for older consumers.
 */
export async function GET() {
  // The model catalog comes from the local agent port (the runtimes share one
  // SDK catalog); port metadata could serve per-port labels when multiple
  // agent ports register.
  const port = agentPortRegistry.forMode("local");
  const raw = new Map<string, CatalogModel>();
  const bracketed: { m: CatalogModel; id: string; params: Record<string, string> }[] = [];

  const catalog = (await port.listCatalog()) ?? [];
  for (const m of catalog) {
    const parsed = parseModelSpec(m.id);
    const id = parsed?.id ?? m.id;
    if (id === "default" || id === "auto") continue; // covered by `default`
    const params = Object.fromEntries(
      (parsed?.params ?? []).filter((p) => !isNoiseFastParam(p)).map((p) => [p.id, p.value]),
    );
    if (Object.keys(params).length) {
      bracketed.push({ m, id, params });
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
    : [...port.fallbackModels];
  const currentDefault = normalizeModelSpec(
    db.getSetting<string>("default_model", "") || config.cursor.defaultModel() || "",
  );
  // Resolve the configured default into structured data so consumers never
  // touch bracket strings; non-opt-in `fast` values are display noise here —
  // the run path (CursorAgentService.pinFastOff) enforces fast=false.
  const parsedDefault = parseModelSpec(currentDefault);
  const defaultChoice = parsedDefault
    ? {
        id: parsedDefault.id,
        params: Object.fromEntries(
          (parsedDefault.params ?? []).filter((p) => !isNoiseFastParam(p)).map((p) => [p.id, p.value]),
        ),
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
