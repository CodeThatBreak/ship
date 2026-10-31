"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { CatalogModel, ModelChoice } from "@/types/modelSpec";
import { useModelCatalog } from '../hooks/useModelCatalog';
import { ModelMenu } from './ModelMenu';
import { ModelOptionsMenu } from './ModelOptionsMenu';
import type { ModelParameterDefinition } from './modelParams';
import {
  defaultParamsOf,
  paramsOf,
  providerOf,
} from './modelParams';

/** Placeholder model shown when the catalog carries nothing usable. */
const NO_MODEL: CatalogModel = { id: "", displayName: "Model" };

/** Back-compat re-export (the definition moved to `model-selector/`). */
export type { ModelParameterDefinition } from './modelParams';

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
  const { data, isLoading, isError, refetch } = useModelCatalog();
  const models = React.useMemo(() => data?.catalog ?? [], [data]);
  // nothing picked = the account's default model; resolve it (id + params)
  // so the menu preselects that model instead of a vague "account default"
  const valueId = value?.id || data?.defaultChoice?.id || data?.default || "";
  const valueParams = React.useMemo(
    () => value?.params ?? data?.defaultChoice?.params ?? {},
    [value, data],
  );

  const options = React.useMemo<CatalogModel[]>(() =>
    models.some((m) => m.id === valueId)
      ? models
      : valueId
        ? [...models, { id: valueId, displayName: valueId }]
        : models,
  [models, valueId]);

  const byProvider = React.useMemo(() => {
    const groups = new Map<string, CatalogModel[]>();
    for (const m of options) {
      const key = providerOf(m.id);
      const group = groups.get(key) ?? [];
      group.push(m);
      groups.set(key, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const current = options.find((m) => m.id === valueId);
  const paramDefs = React.useMemo<ModelParameterDefinition[]>(() => (current ? paramsOf(current) : []), [current]);
  // what the Options button previews: defaults overlaid with explicit picks
  const effectiveParams = React.useMemo(
    () => ({ ...defaultParamsOf(current), ...valueParams }),
    [current, valueParams]
  );

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
      <ModelMenu
        modelLabel={modelLabel}
        valueId={valueId}
        byProvider={byProvider}
        models={models}
        isLoading={isLoading}
        isError={isError}
        onSelect={setModel}
        onRetry={() => void refetch()}
      />

      {/* options menu — fast mode / effort / context for this model */}
      {valueId && paramDefs.length > 0 && (
        <ModelOptionsMenu
          paramDefs={paramDefs}
          effectiveParams={effectiveParams}
          valueParams={valueParams}
          onSetParam={setParam}
        />
      )}
    </div>
  );
}
