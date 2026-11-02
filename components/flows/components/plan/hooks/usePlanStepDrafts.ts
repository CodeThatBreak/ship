import { useState } from "react";
import type { PlanStepRow } from "@/types/flow";
import { ACTION_TYPES } from "../constants/action";
import { buildPayload, emptyDraft, toDraft, type PlanStepDraft } from "../utils/stepDraft";
import type { Action } from "../types/action";

/**
 * Edit-mode state for the plan checklist. Drafts are initialized in
 * `startEdit` rather than an effect (§2.6): editing is only ever entered
 * through it, and every row edit is a draft patch committed with `save`.
 */
export function usePlanStepDrafts(
  steps: PlanStepRow[],
  onAction: (action: Action) => void,
) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<PlanStepDraft[]>([]);

  const startEdit = () => {
    setDrafts(steps.map(toDraft));
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = () => {
    onAction({ type: ACTION_TYPES.UPDATE_PLAN_STEPS, payload: { steps: buildPayload(drafts) } });
    setEditing(false);
  };
  const patch = (i: number, p: Partial<PlanStepDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const addDraft = () => setDrafts((ds) => [...ds, emptyDraft()]);
  const removeAt = (i: number) =>
    setDrafts((ds) => ds.filter((_, j) => j !== i));

  return { editing, drafts, startEdit, cancel, save, patch, addDraft, removeAt };
}
