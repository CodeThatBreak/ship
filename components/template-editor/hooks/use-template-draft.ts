"use client";
/**
 * The editor's draft state machine (§8 Phase 5): the in-memory template graph
 * the canvas and drawers edit, mirrored in a ref so undo/redo and the
 * keyboard handler read the live value even from closures that outlive a
 * render, plus the structural undo/redo snapshots and the "unsaved changes"
 * meta (dirty flag + transient notice) that travel with every edit.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorNode } from "../types";
import type { Draft } from "../draft";

/** How many structural snapshots undo/redo keeps. */
const UNDO_STACK_LIMIT = 50;
/** Bursts of structural edits (typing in a field) coalesce into one snapshot. */
const SNAPSHOT_COALESCE_MS = 500;

export interface UndoRedoOptions {
  /** a structural snapshot may invalidate the open drawers' targets (a node
   *  key gone, edge indexes shifted) — the page closes them when this fires */
  onHistoryJump?: () => void;
}

export interface TemplateDraftMachine {
  /** the current draft (null until the server state is adopted) */
  draft: Draft | null;
  /** the live ref mirror — timers/closures read it without re-subscribing */
  draftRef: React.RefObject<Draft | null>;
  /** replace the draft without touching dirty/history (timers, auto-labels) */
  setDraft: (next: Draft | null | ((cur: Draft | null) => Draft | null)) => void;
  /** a structural edit: snapshots for undo when nodes/edges changed */
  apply: (next: Draft) => void;
  /** one node's meta/config patch — meta-only, no snapshot */
  patchNode: (key: string, patch: Partial<EditorNode>) => void;
  /** adopt server state wholesale (initial load, post-save reload): history resets */
  replaceDraft: (next: Draft) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  setDirty: (next: boolean) => void;
  notice: string | null;
  setNotice: (next: string | null) => void;
}

export function useTemplateDraft(
  initial: Draft | null,
  opts: UndoRedoOptions = {},
): TemplateDraftMachine {
  const [draft, setDraftState] = useState<Draft | null>(initial);
  /** the draft mirrored in a ref — undo/redo and the keyboard handler read the
   *  live value even from closures that outlive a render */
  const draftRef = useRef<Draft | null>(initial);
  const setDraft = useCallback(
    (next: Draft | null | ((cur: Draft | null) => Draft | null)) => {
      const resolved =
        typeof next === "function" ? next(draftRef.current) : next;
      draftRef.current = resolved;
      setDraftState(resolved);
    },
    [],
  );
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ── undo / redo: structural draft snapshots taken in apply() ───────────────
  const undoStack = useRef<Draft[]>([]);
  const redoStack = useRef<Draft[]>([]);
  /** bursts of structural edits (typing in a field) coalesce into one snapshot */
  const lastSnapAt = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncUndoFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);
  const onHistoryJump = useRef(opts.onHistoryJump);
  onHistoryJump.current = opts.onHistoryJump;

  /** undo/redo restores a draft whose nodes/edges may differ from the current
   *  one — a drawer open on a now-different index would edit the wrong element */
  const jump = useCallback(
    (next: Draft) => {
      setDraft(next);
      setDirty(true);
      setNotice(null);
      onHistoryJump.current?.();
      syncUndoFlags();
    },
    [setDraft, syncUndoFlags],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    const cur = draftRef.current;
    if (cur) redoStack.current.push(cur);
    jump(prev);
  }, [jump]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    const cur = draftRef.current;
    if (cur) undoStack.current.push(cur);
    jump(next);
  }, [jump]);

  /** adopt server state wholesale (initial load / post-save reload) —
   *  snapshots of a previous session's draft would rewind past what's on the
   *  server, so the history resets */
  const replaceDraft = useCallback(
    (next: Draft) => {
      undoStack.current = [];
      redoStack.current = [];
      lastSnapAt.current = 0;
      syncUndoFlags();
      setDraft(next);
      setDirty(false);
    },
    [setDraft, syncUndoFlags],
  );

  const apply = useCallback(
    (next: Draft) => {
      const cur = draftRef.current;
      if (cur) {
        // structural changes (nodes/edges replaced) snapshot for undo; meta-only
        // edits and rapid bursts (each keystroke re-replaces the edges array)
        // coalesce into the previous snapshot instead of flooding the stack
        const structural = next.nodes !== cur.nodes || next.edges !== cur.edges;
        const now = Date.now();
        if (
          structural &&
          (undoStack.current.length === 0 ||
            now - lastSnapAt.current > SNAPSHOT_COALESCE_MS)
        ) {
          undoStack.current.push(cur);
          if (undoStack.current.length > UNDO_STACK_LIMIT)
            undoStack.current.shift();
          redoStack.current = [];
          lastSnapAt.current = now;
        }
      }
      setDraft(next);
      setDirty(true);
      setNotice(null);
      syncUndoFlags();
    },
    [setDraft, syncUndoFlags],
  );

  const patchNode = useCallback(
    (key: string, patch: Partial<EditorNode>) => {
      setDraft((cur) =>
        cur
          ? {
              ...cur,
              nodes: cur.nodes.map((p) =>
                p.key === key ? { ...p, ...patch } : p,
              ),
            }
          : cur,
      );
      setDirty(true);
      setNotice(null);
    },
    [setDraft],
  );

  // ⌘Z / Ctrl+Z (and ⇧ for redo) — skipped while typing so text fields keep
  // their native undo, and inert on read-only built-ins
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      e.preventDefault();
      if (draftRef.current?.template.is_builtin) return;
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // unsaved-changes guard: reload / tab close asks before discarding the draft
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return {
    draft,
    draftRef,
    setDraft,
    apply,
    patchNode,
    replaceDraft,
    undo,
    redo,
    canUndo,
    canRedo,
    dirty,
    setDirty,
    notice,
    setNotice,
  };
}
