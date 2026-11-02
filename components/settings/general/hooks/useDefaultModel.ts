"use client";
import { useCallback, useMemo } from "react";
import type { Settings } from "../../context";
import { useModels } from "@/components/chat/hooks/useModels";
import { usePatchSettings } from "./usePatchSettings";

/**
 * The default-model select. `default_model` arrives from the API normalized —
 * no bracket params — and matching rows are normalized by the DB migration;
 * when the catalog is unreachable the stored default is still kept selectable
 * by prepending it to the fallback list.
 */
export function useDefaultModel(settings: Settings) {
  const models = useModels();
  const patch = usePatchSettings();
  const { mutate } = patch;

  const { options, stored, source } = useMemo(() => {
    const list = models?.models ?? [];
    const base = (settings.default_model ?? "").trim();
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
