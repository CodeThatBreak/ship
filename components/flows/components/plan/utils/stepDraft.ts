import type { PlanStepRow } from "@/types/flow";
import type { PlanStepPayload } from "../types";

/** A plan-step row serialized as an editable draft form. */
export interface PlanStepDraft {
  id?: string;
  title: string;
  detail: string;
  files: string;
  branch: string;
}

const toDraft = (s: PlanStepRow): PlanStepDraft => ({
  id: s.id,
  title: s.title,
  detail: s.detail ?? "",
  files: (s.files ?? []).join(", "),
  branch: s.branch ?? "",
});

const emptyDraft = (): PlanStepDraft => ({
  id: undefined,
  title: "",
  detail: "",
  files: "",
  branch: "",
});

const parseFiles = (s: string): string[] =>
  s
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

/** Serialize the editable drafts into the update_plan_steps payload. */
export function buildPayload(drafts: PlanStepDraft[]): PlanStepPayload[] {
  return drafts
    .filter((d) => d.title.trim())
    .map((d) => ({
      // Phase 3B: the plan-step row id rides the payload so a harmless
      // title/detail/files edit keeps the row (and a pending step child's
      // linkage) instead of reading as remove + re-add.
      id: d.id,
      title: d.title.trim(),
      detail: d.detail.trim() || undefined,
      files: parseFiles(d.files),
      branch: d.branch.trim() || null,
    }));
}

export { toDraft, emptyDraft };
