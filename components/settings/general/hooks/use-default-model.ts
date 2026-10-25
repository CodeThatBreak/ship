"use client";
import { useCallback, useMemo } from "react";
import type { Settings } from "../../context";
import { useModels } from "@/components/ModelSelector";
import { usePatchSettings } from "./use-patch-settings";
import { baseModelId } from "../helpers";

/**
 * The default-model select. `default_model` arrives normalized (no bracket
 * params); when the catalog is unreachable the stored default is still kept
 * selectable by prepending it to the fallback list.
 */
export function useDefaultModel(settings: Settings) {
  const models = useModels();
  const patch = usePatchSettings();
  const { mutate } = patch;

  const { options, stored, source } = useMemo(() => {
    const list = models?.models ?? [];
    const base = baseModelId(settings.default_model);
    // catalog fallback (same semantics as before): keep the stored default
    // selectable even when the model list can't show it
    return {
      options: base && !list.includes(base) ? [base, ...list] : list,
      stored: base || null,
      source: models?.source ?? null,
    };
  }, [models, settings.default_model]);

  const save = useCallback(
    (value: string | null, handlers?: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
      mutate({ default_model: value ?? "" }, handlers);
    },
    [mutate],
  );

  return { options, stored, source, save, isPending: patch.isPending };
}
