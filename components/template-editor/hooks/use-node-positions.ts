"use client";
/**
 * Node positions state + the debounced layout autosave (Phase 5/6 save
 * model): node drags land in local state immediately and sync x/y through
 * the positions-only PATCH so layout survives without a structural Save —
 * even while flows run. `layoutSync` is the PATCH's honest state: "pending"
 * while the debounced autosave is in flight, "saved" once it lands, so the
 * header can read "layout autosaved · graph has unsaved changes" instead of
 * one ambiguous "unsaved changes".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasPosition } from "../layout";

/** Debounce window for the positions-only PATCH burst. */
const POSITIONS_SAVE_DEBOUNCE_MS = 700;

export type LayoutSync = "idle" | "pending" | "saved";
export type PositionsMap = Record<string, CanvasPosition>;

export interface NodePositionsApi {
  positions: PositionsMap;
  setPositions: (next: PositionsMap | ((cur: PositionsMap) => PositionsMap)) => void;
  /** adopt dagre-filled positions from the server state (load / post-save reload) */
  resetPositions: (next: PositionsMap) => void;
  /** schedule the debounced positions-only PATCH */
  scheduleSave: () => void;
  layoutSync: LayoutSync;
}

export function useNodePositions(
  templateId: string,
  readOnly: boolean,
  initial?: PositionsMap | null,
): NodePositionsApi {
  const [positions, setPositionsState] = useState<PositionsMap>(initial ?? {});
  const [layoutSync, setLayoutSync] = useState<LayoutSync>("idle");
  /** the upcoming PATCH timer — drags burst into one request */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<PositionsMap>({});
  latest.current = positions;

  const setPositions = useCallback(
    (next: PositionsMap | ((cur: PositionsMap) => PositionsMap)) =>
      setPositionsState(next),
    [],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const schedulePositionsSave = useCallback(() => {
    if (readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setLayoutSync("pending");
    saveTimer.current = setTimeout(() => {
      const snapshot = latest.current;
      fetch(`/api/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: snapshot }),
      })
        .then(() => setLayoutSync("saved"))
        .catch(() => setLayoutSync("idle"));
    }, POSITIONS_SAVE_DEBOUNCE_MS);
  }, [templateId, readOnly]);

  return {
    positions,
    setPositions,
    resetPositions: (next: PositionsMap) => setPositionsState(next),
    scheduleSave: schedulePositionsSave,
    layoutSync,
  };
}
