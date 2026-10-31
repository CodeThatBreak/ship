"use client";
/**
 * The editor's structural Save flow (page-local): validate → PATCH the whole
 * graph → apply the structured problems → refresh the hydrated detail (the
 * hook/version + the always-provisioned webhook) → reseed the draft machine.
 * Owns the save/error surface state and the catalog epoch the palette keys
 * its cache off.
 */
import { useCallback, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  collectPendingDefs,
  problemsMessage,
  type NodePositionsApi,
  type TemplateDraftMachine,
  type TemplateValidationApi,
} from "@/components/template-editor";
import type { TemplateEditorDetail } from "@/types/template-editor";
import { queryKeys } from "@/constants/query-keys";
import { errorMessageOf } from "@/hooks/fetch-json";
import { apiFetch } from "@/hooks/local-api-token";
import { detailToDraft, positionsOf } from "./use-editor-queries";
import {
  editorSaveErrorFromResponse,
  shouldAdoptServerDraftAfterSave,
} from "../utils/editor-save-response";

export interface EditorSaveDeps {
  machine: TemplateDraftMachine;
  layout: NodePositionsApi;
  validation: TemplateValidationApi;
  /** the hydrated detail query — refetched after Save (hook/version sync) */
  detailQuery: UseQueryResult<TemplateEditorDetail, Error>;
  /** flush trailing debounced prompt/config writes before snapshotting */
  flushPendingWrites: () => void;
}

export interface EditorSaveApi {
  saving: boolean;
  /** the last save's error (also covers the validate-blocker wall) */
  error: string | null;
  setError: (next: string | null) => void;
  /** bumped after a Save that may have created catalog rows — the palette
   *  re-fetches so new Library rows show up (Phase 2) */
  catalogEpoch: number;
  save: () => void;
}

export function useEditorSave(deps: EditorSaveDeps): EditorSaveApi {
  const { machine, layout, validation, detailQuery, flushPendingWrites } = deps;
  const {
    draftRef,
    editGenerationRef,
    replaceDraft,
    setDirty,
    setNotice,
  } = machine;
  const { positions, resetPositions } = layout;
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogEpoch, setCatalogEpoch] = useState(0);

  const runSave = useCallback(async () => {
    flushPendingWrites();
    const generationAtStart = editGenerationRef.current;
    const d = draftRef.current;
    if (!d) return;
    setSaving(true);
    setError(null);
    try {
      const problems = await validation.validate(d);
      if (problems.length) {
        setError(problemsMessage(problems));
        return;
      }
      const new_node_templates = collectPendingDefs(d);
      const res = await apiFetch(`/api/templates/${d.template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: d.template.name,
          description: d.template.description,
          trigger: d.template.trigger,
          ...(new_node_templates.length ? { new_node_templates } : {}),
          nodes: d.nodes.map((n) => ({
            key: n.key,
            nodeTemplateId: n.nodeTemplateId,
            label: n.overrideLabel ?? null,
            trigger: n.trigger,
            join_mode: n.join_mode,
            config: n.config,
            input_map: n.input_map,
            x: positions[n.key]?.x ?? null,
            y: positions[n.key]?.y ?? null,
          })),
          edges: d.edges.map((e) => ({
            from: e.from,
            to: e.to,
            kind: e.kind,
            label: e.label,
            condition: e.condition,
          })),
        }),
      });
      const r = (await res.json().catch(() => null)) as { error?: string } | null;
      const saveError = editorSaveErrorFromResponse(res.ok, res.status, r);
      if (saveError) {
        setError(saveError);
        return;
      }

      if (
        shouldAdoptServerDraftAfterSave(
          generationAtStart,
          editGenerationRef.current,
        )
      ) {
        setNotice("Draft saved — new flows snapshot this version.");
        setDirty(false);
        validation.clear();
        if (new_node_templates.length) setCatalogEpoch((e) => e + 1);
        const refreshed = await detailQuery.refetch();
        if (refreshed.data) {
          replaceDraft(detailToDraft(refreshed.data).draft);
          resetPositions(positionsOf(refreshed.data));
        }
      } else {
        setNotice(
          "Draft saved — newer local edits were kept on the canvas.",
        );
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.templatesGallery });
    } catch (e) {
      setError(errorMessageOf(e) ?? "Failed to save the draft — try again.");
    } finally {
      setSaving(false);
    }
  }, [
    draftRef,
    editGenerationRef,
    replaceDraft,
    setDirty,
    setNotice,
    positions,
    resetPositions,
    validation,
    detailQuery,
    flushPendingWrites,
    queryClient,
  ]);

  return {
    saving,
    error,
    setError,
    catalogEpoch,
    save: () => void runSave(),
  };
}
