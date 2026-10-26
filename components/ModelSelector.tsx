"use client";

import * as React from "react";
import { ChevronDownIcon, CpuIcon, ZapIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FAST_OFF, FAST_ON, FAST_PARAM } from "@/constants/models";
import type { CatalogModel, ModelChoice } from "@/lib/modelSpec";

// ── catalog data (normalized server-side by /api/models) ─────────────────────

type ModelsResponse = {
  models: string[];
  catalog: CatalogModel[];
  source: string;
  default: string | null;
  defaultChoice: ModelChoice | null;
};

let cache: ModelsResponse | null = null;

/** Fetch the model catalog (catalog-backed, cached for the session). */
export function useModels() {
  const [data, setData] = React.useState<ModelsResponse | null>(cache);
  React.useEffect(() => {
    if (cache) return;
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: ModelsResponse) => {
        cache = d;
        setData(d);
      })
      .catch(() => {});
  }, []);
  return data;
}

// ── provider grouping (the catalog has no provider field; infer from the id) ─

const PROVIDER_RULES: [RegExp, string][] = [
  [/^claude/, "Anthropic"],
  [/^(gpt|o\d)/, "OpenAI"],
  [/^(gemini|gemma|palm)/, "Google"],
  [/^(composer|auto|max)/, "Cursor"],
  [/^grok/, "xAI"],
  [/^llama/, "Meta"],
  [/^mistral/, "Mistral"],
  [/^(deepseek|qwen)/, "DeepSeek"],
];

function providerOf(modelId: string): string {
  for (const [re, name] of PROVIDER_RULES) if (re.test(modelId.toLowerCase())) return name;
  const prefix = modelId.split(/[-_.]/)[0];
  return prefix ? prefix[0].toUpperCase() + prefix.slice(1) : "Other";
}

// ── parameter derivation ─────────────────────────────────────────────────────
// Static parameter definitions are used as-is; models that only expose
// variants get their parameters derived by diffing the variant param combos.

function paramsOf(model: CatalogModel): ModelParameterDefinition[] {
  if (model.parameters?.length) return model.parameters;
  const combos = model.variants ?? [];
  if (combos.length < 2) return [];
  const defs = new Map<string, Set<string>>();
  for (const v of combos) {
    for (const p of v.params) {
      if (!defs.has(p.id)) defs.set(p.id, new Set());
      defs.get(p.id)!.add(p.value);
    }
  }
  return [...defs.entries()].map(([id, values]) => ({
    id,
    values: [...values].map((value) => ({ value })),
  }));
}

export type ModelParameterDefinition = {
  id: string;
  displayName?: string;
  values: Array<{ value: string; displayName?: string }>;
};

function defaultParamsOf(model?: CatalogModel): Record<string, string> {
  // seed from the default variant so the options menu shows sane values —
  // except fast mode: the account default variant is fast=true on composer
  // models, but DevFlow runs non-fast by default (the run service pins
  // fast=false the same way), so the switch reflects the effective default
  const v = model?.variants?.find((x) => x.isDefault);
  const out: Record<string, string> = {};
  if (v) for (const p of v.params) out[p.id] = p.value;
  if (out[FAST_PARAM] === FAST_ON) out[FAST_PARAM] = FAST_OFF;
  return out;
}

function prettyParamValue(def: ModelParameterDefinition, value: string): string {
  return def.values.find((v) => v.value === value)?.displayName ?? value;
}

/** Boolean params (values are exactly true/false) render as a Switch. */
function isBoolParam(def: ModelParameterDefinition): boolean {
  const vs = def.values.map((v) => v.value).sort();
  return vs.length === 2 && vs[0] === "false" && vs[1] === "true";
}

const NO_MODEL: CatalogModel = { id: "", displayName: "Model" };

/**
 * Model Selector — the shadcn/ui AI Elements pattern
 * (https://ui.shadcn.com/docs/ai-elements/base/model-selector), wired to the
 * flow catalog. The value is structured data ({ id, params }) straight from
 * the API; `null` selects the account's default model. Models are grouped by
 * provider; a second menu offers the selected model's parameters (fast mode
 * toggle, effort / thinking level radios, …).
 */
export default function ModelSelector({
  value,
  onChange,
  className,
}: {
  value?: ModelChoice | null;
  onChange: (choice: ModelChoice | null) => void;
  className?: string;
}) {
  const data = useModels();
  const models = data?.catalog ?? [];
  // nothing picked = the account's default model; resolve it (id + params)
  // so the menu preselects that model instead of a vague "account default"
  const valueId = value?.id || data?.defaultChoice?.id || data?.default || "";
  const valueParams = value?.params ?? data?.defaultChoice?.params ?? {};

  const options: CatalogModel[] = models.some((m) => m.id === valueId)
    ? models
    : valueId
      ? [...models, { id: valueId, displayName: valueId }]
      : models;

  const byProvider = React.useMemo(() => {
    const groups = new Map<string, CatalogModel[]>();
    for (const m of options) {
      const key = providerOf(m.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const current = options.find((m) => m.id === valueId);
  const paramDefs = React.useMemo(() => (current ? paramsOf(current) : []), [current]);
  // what the Options button previews: defaults overlaid with explicit picks
  const effectiveParams = React.useMemo(
    () => ({ ...defaultParamsOf(current), ...valueParams }),
    [current, valueParams]
  );
  const optionsPreview = paramDefs
    .map((def) => {
      const v = effectiveParams[def.id] ?? "";
      if (isBoolParam(def)) {
        // boolean options preview by their on-label ("Fast"), omitted when off
        return v === "true" ? prettyParamValue(def, v) : "";
      }
      return prettyParamValue(def, v);
    })
    .filter(Boolean)
    .join(" · ");

  const modelLabel = current?.displayName ?? (valueId || NO_MODEL.displayName);

  const setModel = (id: string) => onChange(id ? { id } : null);
  const setParam = (def: ModelParameterDefinition, rawValue: string | null) => {
    const next = { ...valueParams };
    if (rawValue) next[def.id] = rawValue;
    else delete next[def.id];
    onChange({ id: valueId, params: next });
  };

  return (
    <div className={cn("flex items-center", className)}>
      {/* model menu — grouped by provider */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <InputGroupButton
              size="xs"
              variant="outline"
              aria-label={`Model: ${modelLabel}`}
              title="Model for runs started from this panel"
              className="max-w-[170px]"
            />
          }
        >
          <CpuIcon className="text-muted-foreground size-3 shrink-0" />
          <span className="truncate text-[11px]">{modelLabel}</span>
          <ChevronDownIcon className="text-muted-foreground size-2.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-72 max-h-80 overflow-y-auto">
          <DropdownMenuRadioGroup value={valueId} onValueChange={(v: string | null) => setModel(v ?? "")}>
            {byProvider.map(([provider, group], gi) => (
              <React.Fragment key={provider}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{provider}</DropdownMenuLabel>
                  {group.map((m) => (
                    <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>
                      {m.displayName}
                      {m.description && (
                        <span className="text-muted-foreground block max-w-64 truncate text-xs font-normal">
                          {m.description}
                        </span>
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              </React.Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* options menu — fast mode / effort / context for this model */}
      {valueId && paramDefs.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <InputGroupButton
                size="xs"
                variant="outline"
                aria-label="Model options"
                title="Model variants: fast mode, effort, context…"
                className="max-w-[130px]"
              />
            }
          >
            <ZapIcon
              className={cn(
                "size-3 shrink-0",
                Object.keys(valueParams).length > 0 ? "text-warning" : "text-muted-foreground",
              )}
            />
            <span className="truncate text-[11px]">{optionsPreview || "Options"}</span>
            <ChevronDownIcon className="text-muted-foreground size-2.5 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-64 max-h-80 overflow-y-auto">
            {paramDefs.map((def, i) => (
              <React.Fragment key={def.id}>
                {i > 0 && <DropdownMenuSeparator />}
                {isBoolParam(def) ? (
                  // boolean option → switch row (Fast on/off)
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5" data-slot="menu-boolean-item">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {def.displayName ?? def.id}
                    </span>
                    <Switch
                      size="sm"
                      checked={(effectiveParams[def.id] ?? "") === "true"}
                      onCheckedChange={(checked) => setParam(def, checked === true ? "true" : "false")}
                      aria-label={
                        `${def.displayName ?? def.id}: ` +
                        ((effectiveParams[def.id] ?? "") === "true" ? "on" : "off")
                      }
                    />
                  </div>
                ) : (
                  <DropdownMenuRadioGroup
                    value={effectiveParams[def.id] ?? ""}
                    onValueChange={(v: string | null) => setParam(def, v)}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>{def.displayName ?? def.id}</DropdownMenuLabel>
                      {def.values.map(({ value: v, displayName }) => (
                        <DropdownMenuRadioItem key={v} value={v} closeOnClick>
                          {displayName ?? prettyParamValue(def, v)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuRadioGroup>
                )}
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
