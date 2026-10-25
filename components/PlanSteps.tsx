"use client";
import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Circle,
  ListChecks,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { PlanStepRow } from "../app/flows/[id]/page";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "./ui/trace";
import { cn } from "../lib/utils";

type Draft = { title: string; detail: string; files: string; branch: string };

const toDraft = (s: PlanStepRow): Draft => ({
  title: s.title,
  detail: s.detail ?? "",
  files: (s.files ?? []).join(", "),
  branch: s.branch ?? "",
});
const emptyDraft = (): Draft => ({
  title: "",
  detail: "",
  files: "",
  branch: "",
});
const parseFiles = (s: string) =>
  s
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

/**
 * The editable structured-plan checklist, laid out per the shadcn ai-elements
 * Plan pattern: a Trace Collapsible whose trigger line shows the progress count
 * and whose content holds the progress bar + steps. Steps are persisted
 * immediately on toggle; title/detail/files edits happen in a draft mode
 * committed with Save. Header action buttons sit *beside* the trigger, never
 * inside it.
 */
export default function PlanSteps({
  flowId,
  steps,
  editable,
  action,
  highlight,
  className,
}: {
  flowId: string;
  steps: PlanStepRow[];
  editable: boolean;
  action: (a: string, b?: any) => void;
  highlight?: boolean; // build node: shown as progress tracker
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    if (editing) setDrafts(steps.map(toDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!steps.length && !editable) return null;

  const done = steps.filter((s) => s.status === "done").length;
  const allDone = steps.length > 0 && done === steps.length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  const startEdit = () => {
    setDrafts(steps.map(toDraft));
    setEditing(true);
  };
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
    <Trace className={cn("min-w-0", className)}>
      <TraceCollapsible defaultOpen>
        {/* header row — action buttons render beside the trigger, not inside it */}
        <div className="flex w-full items-center justify-between gap-2">
          <TraceCollapsibleTrigger className="min-w-0">
            <TraceLine>
              <TraceIcon>
                <ListChecks />
              </TraceIcon>
              <TraceTitle className="text-sm font-semibold text-foreground">
                Plan checklist
              </TraceTitle>
              {steps.length > 0 && (
                <TraceDescription
                  className={allDone ? "text-success/80" : undefined}
                >
                  {done}/{steps.length} done
                </TraceDescription>
              )}
            </TraceLine>
          </TraceCollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-1">
            {editable && !editing && (
              <Button size="xs" variant="secondary" onClick={startEdit}>
                <Pencil size={13} /> Edit steps
              </Button>
            )}
            {editing && (
              <>
                <Button size="xs" variant="secondary" onClick={cancel}>
                  <X size={13} /> Cancel
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  onClick={save}
                  disabled={!drafts.some((d) => d.title.trim())}
                >
                  <Save size={13} /> Save steps
                </Button>
              </>
            )}
          </div>
        </div>

        <TraceCollapsibleContent>
          {/* view mode */}
          {!editing && (
            <div className="grid gap-1 py-1">
              {steps.map((s) => {
                const isDone = s.status === "done";
                return (
                  <div
                    key={s.id}
                    className="flex items-start gap-2.5 py-1.5 group"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={!editable && !highlight}
                      title={isDone ? "Mark as not done" : "Mark as done"}
                      onClick={() =>
                        action("set_plan_step", {
                          stepId: s.id,
                          status: isDone ? "pending" : "done",
                        })
                      }
                      className={cn(
                        "mt-[1px] shrink-0",
                        isDone
                          ? "text-success hover:text-success"
                          : "text-muted-foreground hover:text-info",
                        !editable && !highlight && "cursor-default",
                      )}
                    >
                      {isDone ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <Circle size={17} />
                      )}
                    </Button>
                    <div className="flex-1 min-w-0">
                      <span
                        className={cn(
                          "text-[13px] leading-snug text-foreground",
                          isDone && "line-through text-muted-foreground",
                        )}
                      >
                        {s.title}
                      </span>
                      {s.detail && (
                        <p
                          className={cn(
                            "text-xs text-muted-foreground mt-0.5 mb-0 leading-snug",
                            isDone && "line-through",
                          )}
                        >
                          {s.detail}
                        </p>
                      )}
                      <span className="flex gap-1 mt-1 flex-wrap">
                        {s.branch && (
                          <Badge className="bg-violet-500/10 text-violet-400">
                            {s.branch}
                          </Badge>
                        )}
                        {s.completed_by === "build" && isDone && (
                          <Badge className="bg-success/10 text-success">
                            <Check size={10} /> by build
                          </Badge>
                        )}
                        {s.origin === "user" && <Badge>manual</Badge>}
                        {(s.files ?? []).map((f) => (
                          <code
                            key={f}
                            className="text-[11px] text-muted-foreground bg-card border border-border rounded-lg px-1 py-px"
                          >
                            {f}
                          </code>
                        ))}
                      </span>
                    </div>
                  </div>
                );
              })}
              {steps.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">
                  No steps yet — Edit steps to build the checklist by hand.
                </p>
              )}
            </div>
          )}

          {/* edit mode */}
          {editing && (
            <div className="grid gap-2.5">
              {drafts.map((d, i) => (
                <div
                  key={i}
                  className="border border-border rounded-lg p-2.5 grid gap-1.5 bg-card/40"
                >
                  <div className="flex gap-1.5 items-center">
                    <span className="text-xs text-muted-foreground w-5 text-center shrink-0">
                      {i + 1}
                    </span>
                    <Input
                      value={d.title}
                      onChange={(e) => patch(i, { title: e.target.value })}
                      placeholder="Step title (required)"
                      className="py-1.5"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Remove step"
                      onClick={() =>
                        setDrafts((ds) => ds.filter((_, j) => j !== i))
                      }
                    >
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
              <Button
                size="sm"
                variant="ghost"
                className="justify-self-start"
                onClick={() => setDrafts((ds) => [...ds, emptyDraft()])}
              >
                <Plus size={13} /> Add step
              </Button>
            </div>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
