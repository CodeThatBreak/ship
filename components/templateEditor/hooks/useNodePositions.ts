"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { JsonErrorBody } from "@/hooks/fetchJson";
import { apiFetch } from "@/hooks/localApiToken";
import { queryKeys } from "@/constants/queryKeys";
import type { TemplateEditorDetail } from "@/types/templateEditor";

import type { CanvasPosition } from "../layout";

const POSITIONS_SAVE_DEBOUNCE_MS = 700;

export type LayoutSync = "idle" | "pending" | "saved" | "error";
export type PositionsMap = Record<string, CanvasPosition>;

export interface NodePositionsApi {
  positions: PositionsMap;
  setPositions: (next: PositionsMap | ((cur: PositionsMap) => PositionsMap)) => void;
  resetPositions: (next: PositionsMap) => void;
  scheduleSave: () => void;
  layoutSync: LayoutSync;
}

export const layoutSyncFromPatchOk = (ok: boolean): "saved" | "error" =>
  ok ? "saved" : "error";

export const mergePositionsIntoDetail = (
  detail: TemplateEditorDetail,
  positions: PositionsMap,
): TemplateEditorDetail => ({
  ...detail,
  nodes: detail.nodes.map((n) => {
    const pos = positions[n.key];
    if (!pos) return n;
    return { ...n, x: pos.x, y: pos.y };
  }),
});

async function patchTemplatePositions(
  templateId: string,
  positions: PositionsMap,
): Promise<void> {
  const res = await apiFetch(`/api/templates/${templateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as JsonErrorBody;
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
}

export const useNodePositions = (
  templateId: string,
  readOnly: boolean,
  initial?: PositionsMap | null,
): NodePositionsApi => {
  const queryClient = useQueryClient();
  const [positions, setPositionsState] = useState<PositionsMap>(initial ?? {});
  const [layoutSync, setLayoutSync] = useState<LayoutSync>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<PositionsMap>(initial ?? {});
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const saveMutation = useMutation({
    mutationFn: (snapshot: PositionsMap) => patchTemplatePositions(templateId, snapshot),
    onMutate: () => setLayoutSync("pending"),
    onSuccess: (_data, snapshot) => {
      setLayoutSync("saved");
      queryClient.setQueryData<TemplateEditorDetail>(
        queryKeys.templates.detail(templateId),
        (cur) => (cur ? mergePositionsIntoDetail(cur, snapshot) : cur),
      );
    },
    onError: () => setLayoutSync("error"),
  });

  const setPositions = useCallback(
    (next: PositionsMap | ((cur: PositionsMap) => PositionsMap)) => {
      setPositionsState((cur) => {
        const resolved = typeof next === "function" ? next(cur) : next;
        latest.current = resolved;
        return resolved;
      });
    },
    [],
  );

  const flushPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (readOnlyRef.current) return;
    const snapshot = latest.current;
    void apiFetch(`/api/templates/${templateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions: snapshot }),
      keepalive: true,
    }).then((res) => {
      if (res.ok) {
        queryClient.setQueryData<TemplateEditorDetail>(
          queryKeys.templates.detail(templateId),
          (cur) => (cur ? mergePositionsIntoDetail(cur, snapshot) : cur),
        );
      }
    });
  }, [queryClient, templateId]);

  useEffect(
    () => () => {
      flushPendingSave();
    },
    [flushPendingSave],
  );

  const schedulePositionsSave = useCallback(() => {
    if (readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setLayoutSync("pending");
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      saveMutation.mutate(latest.current);
    }, POSITIONS_SAVE_DEBOUNCE_MS);
  }, [readOnly, saveMutation]);

  const resetPositions = useCallback((next: PositionsMap) => {
    latest.current = next;
    setPositionsState(next);
  }, []);

  return useMemo(
    () => ({
      positions,
      setPositions,
      resetPositions,
      scheduleSave: schedulePositionsSave,
      layoutSync,
    }),
    [positions, setPositions, resetPositions, schedulePositionsSave, layoutSync],
  );
};
