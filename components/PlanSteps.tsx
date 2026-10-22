"use client";
import { useEffect, useState } from "react";
import { Check, CheckCircle2, Circle, ListChecks, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { PlanStepRow } from "../app/flows/[id]/page";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { cn } from "../lib/utils";

type Draft = { title: string; detail: string; files: string; branch: string };

const toDraft = (s: PlanStepRow): Draft => ({
  title: s.title,
  detail: s.detail ?? "",
  files: (s.files ?? []).join(", "),
  branch: s.branch ?? "",
});
const emptyDraft = (): Draft => ({ title: "", detail: "", files: "", branch: "" });
const parseFiles = (s: string) => s.split(",").map((f) => f.trim()).filter(Boolean);

/**
 * The editable structured-plan checklist. Steps are persisted immediately on
 * toggle; title/detail/files edits happen in a draft mode committed with Save.
 */
export default function PlanSteps({
  flowId, steps, editable, action, highlight,
}: {
  flowId: string;
  steps: PlanStepRow[];
  editable: boolean;
  action: (a: string, b?: any) => void;
  highlight?: boolean; // build node: shown as progress tracker
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    if (editing) setDrafts(steps.map(toDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!steps.length && !editable) return null;

  const done = steps.filter((s) => s.status === "done").length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  const startEdit = () => { setDrafts(steps.map(toDraft)); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = () => {
    const payload = drafts
      .filter((d) => d.title.trim())
      .map((d) => ({
        title: d.title.trim(),
        detail: d.detail.trim() || undefined,
        files: parseFiles(d.files),
        branch: d.branch.trim() || null,
      }));
    action("update_plan_steps", { steps: payload });
    setEditing(false);
  };
  const patch = (i: number, p: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));

  return (
    <Card className="px-4 py-3 mb-4">
      {/* header + progress */}
      <div className="flex items-center gap-2 mb-2">
        <ListChecks size={15} className="text-accent" />
        <h3 className="text-sm font-semibold m-0">Plan checklist</h3>
        {steps.length > 0 && (
          <Badge variant={done === steps.length ? "green" : "blue"}>{done}/{steps.length} done</Badge>
        )}
        <div className="flex-1" />
        {editable && !editing && (
          <Button size="sm" variant="ghost" onClick={startEdit}>
            <Pencil size={13} /> Edit steps
          </Button>
        )}
        {editing && (
          <>
            <Button size="sm" variant="ghost" onClick={cancel}><X size={13} /> Cancel</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={!drafts.some((d) => d.title.trim())}>
              <Save size={13} /> Save steps
            </Button>
          </>
        )}
      </div>

      {steps.length > 0 && (
        <div className="h-[5px] rounded-full bg-panel-3 overflow-hidden mb-3">
          <div
            className={cn("h-full rounded-full transition-all duration-500", done === steps.length ? "bg-green" : "bg-accent")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* view mode */}
      {!editing && (
        <div className="grid gap-1">
          {steps.map((s) => {
            const isDone = s.status === "done";
            return (
              <div key={s.id} className="flex items-start gap-2.5 py-1.5 group">
                <button
                  type="button"
                  disabled={!editable && !highlight}
                  title={isDone ? "Mark as not done" : "Mark as done"}
                  onClick={() => action("set_plan_step", { stepId: s.id, status: isDone ? "pending" : "done" })}
                  className={cn(
                    "mt-[1px] shrink-0 transition-colors",
                    isDone ? "text-green" : "text-muted hover:text-accent",
                    !editable && !highlight && "cursor-default"
                  )}
                >
                  {isDone ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                </button>
                <div className="flex-1 min-w-0">
                  <span className={cn("text-[13px] leading-snug", isDone && "line-through text-muted")}>
                    {s.title}
                  </span>
                  {s.detail && (
                    <p className={cn("text-xs text-muted mt-0.5 mb-0 leading-snug", isDone && "line-through")}>
                      {s.detail}
                    </p>
                  )}
                  <span className="flex gap-1 mt-1 flex-wrap">
                    {s.branch && <Badge variant="purple">{s.branch}</Badge>}
                    {s.completed_by === "build" && isDone && <Badge variant="green"><Check size={10} /> by build</Badge>}
                    {s.origin === "user" && <Badge>manual</Badge>}
                    {(s.files ?? []).map((f) => (
                      <code key={f} className="text-[11px] text-muted bg-panel-2 border border-border-soft rounded px-1 py-px">{f}</code>
                    ))}
                  </span>
                </div>
              </div>
            );
          })}
          {steps.length === 0 && (
            <p className="text-xs text-muted">No steps yet — Edit steps to build the checklist by hand.</p>
          )}
        </div>
      )}

      {/* edit mode */}
      {editing && (
        <div className="grid gap-2.5">
          {drafts.map((d, i) => (
            <div key={i} className="border border-border-soft rounded-[10px] p-2.5 grid gap-1.5 bg-panel-2/40">
              <div className="flex gap-1.5 items-center">
                <span className="text-xs text-muted w-5 text-center shrink-0">{i + 1}</span>
                <Input
                  value={d.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                  placeholder="Step title (required)"
                  className="py-1.5"
                />
                <Button size="icon" variant="dangerGhost" title="Remove step"
                  onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </Button>
              </div>
              <Textarea
                value={d.detail}
                onChange={(e) => patch(i, { detail: e.target.value })}
                placeholder="Detail — what to change and why (optional)"
                rows={2}
                className="py-1.5 text-xs"
              />
              <div className="flex gap-1.5">
                <Input
                  value={d.files}
                  onChange={(e) => patch(i, { files: e.target.value })}
                  placeholder="Files, comma-separated (optional)"
                  className="py-1.5 text-xs font-mono"
                />
                <Input
                  value={d.branch}
                  onChange={(e) => patch(i, { branch: e.target.value })}
                  placeholder="Branch (optional)"
                  className="py-1.5 text-xs font-mono max-w-[160px]"
                />
              </div>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start"
            onClick={() => setDrafts((ds) => [...ds, emptyDraft()])}>
            <Plus size={13} /> Add step
          </Button>
        </div>
      )}
    </Card>
  );
}
