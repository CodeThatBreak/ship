"use client";
import { Trash2 } from "lucide-react";
import type { PlanStepDraft } from "../../utils/stepDraft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** One editable checklist draft row: title (required), detail, files, branch. */
export function PlanStepDraftRow({
  draft,
  index,
  onPatch,
  onRemove,
}: {
  draft: PlanStepDraft;
  index: number;
  onPatch: (i: number, patch: Partial<PlanStepDraft>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div
      className="border border-border rounded-lg p-2.5 grid gap-1.5 bg-card/40"
    >
      <div className="flex gap-1.5 items-center">
        <span className="text-xs text-muted-foreground w-5 text-center shrink-0">
          {index + 1}
        </span>
        <Input
          value={draft.title}
          onChange={(e) => onPatch(index, { title: e.target.value })}
          placeholder="Step title (required)"
          className="py-1.5"
        />
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          title="Remove step"
          onClick={() => onRemove(index)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <Textarea
        value={draft.detail}
        onChange={(e) => onPatch(index, { detail: e.target.value })}
        placeholder="Detail — what to change and why (optional)"
        rows={2}
        className="py-1.5 text-xs"
      />
      <div className="flex gap-1.5">
        <Input
          value={draft.files}
          onChange={(e) => onPatch(index, { files: e.target.value })}
          placeholder="Files, comma-separated (optional)"
          className="py-1.5 text-xs font-mono"
        />
        <Input
          value={draft.branch}
          onChange={(e) => onPatch(index, { branch: e.target.value })}
          placeholder="Branch (optional)"
          className="py-1.5 text-xs font-mono max-w-[160px]"
        />
      </div>
    </div>
  );
}
