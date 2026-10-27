import { useState } from "react";
import type { PlanStepRow } from "@/types/flow";
import { PLAN_STEP_ACTION } from "../constants";
import { buildPayload, emptyDraft, toDraft, type PlanStepDraft } from "../step-draft";
import type { FlowAction } from "../types";

/**
 * Edit-mode state for the plan checklist. Drafts are initialized in
 * `startEdit` rather than an effect (§2.6): editing is only ever entered
 * through it, and every row edit is a draft patch committed with `save`.
 */
export function usePlanStepDrafts(steps: PlanStepRow[], action: FlowAction) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<PlanStepDraft[]>([]);

  const startEdit = () => {
    setDrafts(steps.map(toDraft));
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = () => {
    action(PLAN_STEP_ACTION.UPDATE, { steps: buildPayload(drafts) });
    setEditing(false);
  };
  const patch = (i: number, p: Partial<PlanStepDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const addDraft = () => setDrafts((ds) => [...ds, emptyDraft()]);
  const removeAt = (i: number) =>
    setDrafts((ds) => ds.filter((_, j) => j !== i));

  return { editing, drafts, startEdit, cancel, save, patch, addDraft, removeAt };
}
