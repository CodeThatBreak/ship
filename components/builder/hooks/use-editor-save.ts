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
import {
  collectPendingDefs,
  problemsMessage,
  type NodePositionsApi,
  type TemplateDraftMachine,
  type TemplateValidationApi,
} from "@/components/template-editor";
import type { TemplateEditorDetail } from "@/types/template-editor";
import { detailToDraft, positionsOf } from "./use-editor-queries";

export interface EditorSaveDeps {
  machine: TemplateDraftMachine;
  layout: NodePositionsApi;
  validation: TemplateValidationApi;
  /** the hydrated detail query — refetched after Save (hook/version sync) */
  detailQuery: UseQueryResult<TemplateEditorDetail, Error>;
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
  const { machine, layout, validation, detailQuery } = deps;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogEpoch, setCatalogEpoch] = useState(0);

  const runSave = useCallback(async () => {
    const d = machine.draft;
    if (!d) return;
    setSaving(true);
    setError(null);
    try {
      // validate before PATCH (Phase 5): the same structured lint the live
      // validation runs — problems block the save and land on their node /
      // edge as badges, instead of one concatenated wall of save errors
      const problems = await validation.validate(d);
      if (problems.length) {
        setError(problemsMessage(problems));
        return;
      }
      // draft declarative defs (Phase 2): the tiles placed in-memory instances;
      // only defs still referenced by a node are persisted, with the authored
      // instance config folded in so the Library row reflects what was authored
      const new_node_templates = collectPendingDefs(d);
      const res = await fetch(`/api/templates/${d.template.id}`, {
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
            x: layout.positions[n.key]?.x ?? null,
            y: layout.positions[n.key]?.y ?? null,
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
      if (res.status !== 400 && !r?.error) {
        machine.setNotice("Draft saved — new flows snapshot this version.");
        machine.setDirty(false);
        validation.clear();
        // the catalog may have gained Library rows (draft defs persisted) —
        // bump the epoch so the palette re-fetches (Phase 2)
        if (new_node_templates.length) setCatalogEpoch((e) => e + 1);
        // the hook (always provisioned) is provisioned/synced server-side —
        // refresh it (and the template version) from the query cache
        const refreshed = await detailQuery.refetch();
        if (refreshed.data) {
          // adopt the saved server state: the history resets and the canvas
          // layout re-seeds from the persisted positions
          machine.replaceDraft(detailToDraft(refreshed.data).draft);
          layout.resetPositions(positionsOf(refreshed.data));
        }
      } else {
        setError(r?.error ?? "Failed to save the draft — try again.");
      }
    } finally {
      setSaving(false);
    }
  }, [machine, layout, validation, detailQuery]);

  return {
    saving,
    error,
    setError,
    catalogEpoch,
    save: () => void runSave(),
  };
}
