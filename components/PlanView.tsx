"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Compass,
  Check,
  GitBranch,
  ListChecks,
  Layers,
  AlertTriangle,
  RotateCcw,
  Pencil,
  Info,
  Square,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
} from "lucide-react";
import type { FlowData, Node, Artifact } from "../app/flows/[id]/page";
import { Markdown } from "../components/markdown";
import PlanSteps from "./PlanSteps";
import PromptModal, { type PromptRunExtras } from "./PromptModal";
import { VersionTabs, ArtifactLoader, CostChip } from "./panels/shared";
import { registerPanel } from "./panels/registry";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// ── branch step diff (client copy of the engine's id-based classifier) ──────

interface DiffStep {
  id: string;
  title: string;
  detail?: string;
  files?: string[];
}
interface BranchStepDiff {
  added: DiffStep[];
  removed: DiffStep[];
  changed: { id: string; before: DiffStep; after: DiffStep }[];
}

const contentEqual = (a: DiffStep, b: DiffStep) =>
  a.title === b.title &&
  a.detail === b.detail &&
  JSON.stringify(a.files ?? []) === JSON.stringify(b.files ?? []);

/** Id-based diff with a title fallback — merge preserves ids for unchanged steps, so ids mean identity. */
function diffBranchSteps(
  oldSteps: DiffStep[],
  newSteps: DiffStep[],
): BranchStepDiff {
  const byId = (arr: DiffStep[]) =>
    new Map(arr.filter((s) => s.id).map((s) => [s.id, s]));
  const oldById = byId(oldSteps);
  const newById = byId(newSteps);

  const added: DiffStep[] = [];
  const changed: { id: string; before: DiffStep; after: DiffStep }[] = [];
  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) added.push(next);
    else if (!contentEqual(prev, next))
      changed.push({ id, before: prev, after: next });
  }
  const leftoversOld = [...oldById.values()].filter((s) => !newById.has(s.id!));
  const removed: DiffStep[] = [];
  for (const o of leftoversOld) {
    // agents occasionally rename ids on unchanged steps — promote title matches
    const idx = added.findIndex(
      (n) => n.title === o.title && contentEqual(o, n),
    );
    if (idx >= 0) {
      changed.push({
        id: `${o.id} → ${added[idx].id}`,
        before: o,
        after: added[idx],
      });
      added.splice(idx, 1);
    } else {
      removed.push(o);
    }
  }
  return { added, removed, changed };
}

/**
 * The latest version at which a branch's scoped markdown was written, from
 * artifact metas (scopedRefine provenance).
 */
function latestScopedRefineVersion(
  arts: Artifact[],
  branchName: string,
): number {
  let v = 0;
  for (const a of arts) {
    const sr = a.meta?.scopedRefine;
    if (
      sr?.branch === branchName &&
      typeof sr.from === "number" &&
      a.version > v
    )
      v = a.version;
  }
  return v;
}

export default function PlanView({
  flow,
  node,
  action,
  fetchArtifact,
  model,
  planOptions = { decompose: false, complex: false },
}: {
  flow: FlowData;
  node: Node;
  action: (a: string, b?: any) => void;
  fetchArtifact: (id: string) => Promise<any>;
  model: string;
  /** generation options toggled in the chat panel (complex affects refines as well) */
  planOptions?: { decompose: boolean; complex: boolean };
}) {
  const plans = node.artifacts.filter((a: Artifact) => a.kind === "plan");
  const [sel, setSel] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  // branch-scoped refine state (§7.1): which branch is being refined + the open tab
  const [refineBranch, setRefineBranch] = useState<string | null>(null);
  const [openBranchTab, setOpenBranchTab] = useState<string | null>(null);
  const [freshScoped, setFreshScoped] = useState(true);
  const current = plans.find((a) => a.id === sel) ?? plans[plans.length - 1];
  const awaiting = node.status === "awaiting_approval";
  const running = node.status === "running";
  const isCurrent = current && current.id === plans[plans.length - 1]?.id;

  // Phase 3A: extract branches from the plan output or artifact meta
  const branches = node.output?.branches ?? null;
  // structured checklist (live rows; editable until the plan is approved)
  const planSteps = flow.planSteps ?? [];
  const showChecklist =
    planSteps.length > 0 || awaiting || node.status === "approved";

  // plan fan-out (§1 who-decides-the-mode): the published execution
  // resolution (plan-meta `execution` on the selected version) + the plan
  // node's knob precedence. `follow` plans publish the PLANNER's decision
  // (with a one-line rationale); the footer offers the override control at
  // approve (Phase 3B) — forcing whole/steps writes executionSource
  // "override" into the plan-meta on approve_plan.
  const knobExecution = (node.config as Record<string, unknown> | null | undefined)?.execution_default;
  const meta = current?.meta ?? {};
  const published = meta.execution === "steps" ? "steps" : "whole";
  const publishedSource = typeof meta.executionSource === "string" ? meta.executionSource : "unknown";
  const plannerRationale = typeof meta.execution_rationale === "string" ? meta.execution_rationale : null;
  const executionResolution =
    knobExecution === "steps" ? "steps"
      : knobExecution === "follow" ? published
        : published;
  const [execPick, setExecPick] = useState<"whole" | "steps">(executionResolution === "steps" ? "steps" : "whole");
  // a refine re-publishes the resolution — the pick follows the new published value
  useEffect(() => {
    setExecPick(executionResolution === "steps" ? "steps" : "whole");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, executionResolution]);
  const executionNote =
    executionResolution === "steps"
      ? `step-by-step (${planSteps.length} step${planSteps.length === 1 ? "" : "s"})`
      : "one run";

  const statusVariant =
    node.status === "approved"
      ? "bg-success/10 text-success"
      : node.status === "running"
        ? "bg-info/10 text-info"
        : node.status === "awaiting_approval"
          ? "bg-warning/10 text-warning"
          : node.status === "failed"
            ? undefined
            : undefined;

  // malformed plan-meta: the agent returned a plan but the structured block
  // failed validation even after the automatic retry
  const malformed = node.output?.malformed === true;
  const validationErrors: { path: string; message: string }[] =
    node.output?.validationErrors ?? [];

  const startPlan = (prompt?: string, promptIsBody?: boolean) =>
    action("start_plan", {
      prompt,
      promptIsBody: promptIsBody || undefined,
      model: model || undefined,
      complex: planOptions.complex || undefined,
    });

  // Edit prompt runs a fresh plan when none exists yet; once a plan exists it
  // reruns as a refinement of the current one.
  const runWithPrompt = (prompt: string, promptIsBody: boolean) => {
    if (plans.length > 0) {
      action("refine_plan", {
        feedback: "",
        prompt,
        promptIsBody: promptIsBody || undefined,
        model: model || undefined,
        complex: planOptions.complex || undefined,
      });
    } else {
      startPlan(prompt, promptIsBody);
    }
  };

  // Branch-scoped sub-plan refine (§7.1): promptIsBody — the modal returns the
  // developer-editable body; the engine appends the internal scoped rules.
  const runBranchRefine = (
    prompt: string,
    promptIsBody: boolean,
    extras: PromptRunExtras,
  ) => {
    if (!refineBranch) return;
    action("refine_plan", {
      prompt,
      promptIsBody: promptIsBody || undefined,
      complex: true,
      branchRef: refineBranch,
      fresh: extras.fresh ?? true, // scoped refines default fresh (§3)
      contextBlocks: extras.contextBlocks,
    });
  };

  // ── scoped-refine diff banner data (§6/§7.3): computed client-side from the
  // two artifact versions' steps — no server diff endpoint needed.
  const scopedDiff = useMemo(() => {
    const latest = plans[plans.length - 1];
    const sr = latest?.meta?.scopedRefine;
    if (!sr?.branch || latest?.meta?.steps == null) return null;
    const prev = plans.find((a) => a.version === sr.from);
    if (!prev?.meta?.steps) return null;
    const branch = sr.branch as string;
    const pick = (meta: any) =>
      (meta.steps as any[]).filter((s) => s.branch === branch);
    const diff = diffBranchSteps(pick(prev.meta), pick(latest.meta));
    if (!diff.added.length && !diff.removed.length && !diff.changed.length)
      return null;
    return { branch, from: sr.from as number, to: latest.version, diff };
  }, [plans]);

  // Staleness (§8): the overview prose is only rewritten by full-plan refines;
  // a scoped refine makes its branch doc newer than the overview.
  const staleBranches = useMemo(() => {
    if (!branches || plans.length === 0) return new Map<string, number>();
    const overviewVersion = current?.version ?? 0;
    const out = new Map<string, number>();
    for (const b of branches) {
      if (!b.markdown) continue;
      const v = latestScopedRefineVersion(plans, b.name);
      if (v > overviewVersion) out.set(b.name, v);
    }
    return out;
  }, [branches, plans, current?.version]);
  const hasStaleBranches = staleBranches.size > 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sticky header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
        <h2 className="m-0 text-[15px]">Implementation plan</h2>
        <Badge
          className={statusVariant}
          variant={node.status === "failed" ? "destructive" : undefined}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {node.status.replace(/_/g, " ")}
        </Badge>
        <CostChip node={node} />
        <div className="flex-1" />
        <Button
          size="xs"
          variant="secondary"
          onClick={() => setShowPrompt(true)}
        >
          <Pencil size={12} /> Edit prompt
        </Button>
      </div>

      {/* scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4 flex flex-col gap-4">
        {node.status === "failed" && (
          <Alert variant="destructive">
            <AlertTriangle size={16} className="shrink-0" />
            <div className="flex-1">
              {malformed ? (
                <>
                  <span className="font-medium">Malformed plan response</span>
                  <p className="text-xs mt-1 mb-0">
                    The agent generated a plan but the structured plan-meta
                    block failed validation.
                    {validationErrors.length > 0 && (
                      <ul className="mt-1.5 ml-3 list-disc text-xs text-destructive/80">
                        {validationErrors.map((e, i) => (
                          <li key={i}>
                            {e.path ? `${e.path}: ` : ""}
                            {e.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </p>
                </>
              ) : (
                <span>
                  This step failed — check the activity feed for details.
                </span>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => action("retry", { nodeKey: node.node_key })}
            >
              <RotateCcw size={13} /> Retry
            </Button>
          </Alert>
        )}

        {plans.length === 0 && node.status === "pending" && (
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="text-center px-5">
              <Compass size={32} className="text-muted-foreground mb-3 mx-auto" />
              <p className="text-muted-foreground max-w-[380px] mx-auto">
                The plan prompt is ready as a preview box over the chat panel —
                review or edit it there to generate an implementation plan from
                the task PRD, Figma links, and the repository.
              </p>
            </div>
          </div>
        )}

        {running && (
          <div className="flex flex-col items-center justify-center text-center px-5 py-20 gap-3">
            <Spinner className="size-[22px] border-[3px]" />
            <p className="text-muted-foreground text-sm font-medium m-0">
              {plans.length === 0
                ? "Agent is cooking up the plan…"
                : "Agent is reworking the plan…"}
            </p>
            <p className="text-muted-foreground text-xs m-0">
              Grabbing coffee while it reads the repo — watch the activity feed
              →
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1"
              onClick={() => action("cancel", { nodeKey: node.node_key })}
            >
              <Square size={12} /> Stop agent
            </Button>
          </div>
        )}

        {plans.length > 1 && (
          <VersionTabs arts={plans} sel={current?.id} onSel={setSel} />
        )}

        {/* ── main plan (level 1) — always on top, never hidden by an open sub-plan ── */}
        {current && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Layers size={14} /> Main plan
            </h3>

            <ArtifactLoader
              id={current.id}
              fetchArtifact={fetchArtifact}
              render={(a: any) => (
                <div>
                  {a.meta?.feedback && (
                    <div className="text-xs text-muted-foreground border-l-[3px] border-violet-500 pl-2.5 mb-3">
                      Refined from feedback: "{a.meta.feedback}"
                    </div>
                  )}
                  <Card className="px-4 py-4">
                    <Markdown className="text-[13px]">{a.content}</Markdown>
                  </Card>
                </div>
              )}
            />
          </div>
        )}

        {/* ── sub-plans (level 2) — indented under the main plan to show hierarchy ── */}
        {branches && branches.length > 0 && (
          <div className="ml-4 pl-4 border-l border-border">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground">
              <GitBranch size={14} /> Sub-plans · {branches.length} branch
              {branches.length > 1 ? "es" : ""}
            </h3>

            {/* staleness note when any branch doc is newer than the overview (§8) */}
            {hasStaleBranches && (
              <p className="text-[11.5px] text-muted-foreground mb-2 flex items-start gap-1.5">
                <Info size={12} className="shrink-0 mt-[1px]" />
                branch sub-plans are more recent than this overview — open a
                sub-plan for its current document
              </p>
            )}

            <div className="grid gap-2">
              {branches.map((b: any) => {
                const staleV = staleBranches.get(b.name);
                const expanded = openBranchTab === b.name;
                // scoped-refine provenance tag (§6/§7.3) — which plan changed, as a tag
                // on the changed branch card itself; no expandable diff rows.
                const refined =
                  scopedDiff?.branch === b.name ? scopedDiff : null;
                return (
                  <Card key={b.name} className="px-3.5 py-2.5 gap-0">
                    <button
                      className="w-full flex items-center gap-2 text-left min-w-0"
                      onClick={() => setOpenBranchTab(expanded ? null : b.name)}
                    >
                      {expanded ? (
                        <ChevronDown
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                      ) : (
                        <ChevronRight
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                      )}
                      <Badge className="bg-info/10 text-info shrink-0">
                        {b.name}
                      </Badge>
                      <span className="font-medium text-[13px] truncate">
                        {b.title}
                      </span>
                      <span className="flex-1" />

                      {refined && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge className="bg-warning/10 text-warning shrink-0">
                              <ArrowRightLeft size={10} /> refined v
                              {refined.from} → v{refined.to}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            This branch was refined by a scoped run (v
                            {refined.from} → v{refined.to}):{" "}
                            {[
                              refined.diff.changed.length
                                ? `${refined.diff.changed.length} step${refined.diff.changed.length > 1 ? "s" : ""} changed`
                                : null,
                              refined.diff.added.length
                                ? `${refined.diff.added.length} added`
                                : null,
                              refined.diff.removed.length
                                ? `${refined.diff.removed.length} removed`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(", ")}{" "}
                            — other branches untouched
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {staleV && !refined && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge className="bg-warning/10 text-warning shrink-0">
                              ● sub-plan refined v{staleV}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            This branch's document was refined by a scoped run
                            (v{staleV}) newer than the overview you're viewing
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </button>
                    {/* one compact meta row: scope · depends on · counts · refine */}
                    <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground mt-1.5">
                      {b.scope && (
                        <span className="truncate min-w-0" title={b.scope}>
                          {b.scope}
                        </span>
                      )}
                      {b.dependsOn?.length > 0 && (
                        <span
                          className="shrink-0"
                          title={b.dependsOn.join(", ")}
                        >
                          ↳ depends on: {b.dependsOn.join(", ")}
                        </span>
                      )}
                      <span className="flex-1" />
                      {awaiting && isCurrent && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Button
                              size="xs"
                              variant="secondary"
                              className="shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRefineBranch(b.name);
                                setFreshScoped(true); // scoped refines default to a fresh agent (§3)
                                setOpenBranchTab(null);
                              }}
                            >
                              <Pencil size={11} /> Refine
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Refine ONLY this branch's sub-plan — the agent
                            rewrites one branch, not the whole plan; everything
                            else stays untouched
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    {expanded && (
                      <div className="mt-2 pt-1.5 border-t border-border">
                        {/* bounded scrollable doc — expanding doesn't stretch the card */}
                        <ScrollArea className="max-h-72">
                          {b.markdown ? (
                            <Markdown className="text-[13px]">
                              {b.markdown}
                            </Markdown>
                          ) : (
                            <div className="px-1">
                              <p className="text-xs text-muted-foreground mb-1.5">
                                No branch document yet — refined sub-plans write
                                one. The main plan still covers this branch.
                              </p>
                              {b.subPlan?.prompt && (
                                <p className="text-xs text-muted-foreground mb-1">
                                  <span className="text-muted-foreground">
                                    Sub-plan prompt:
                                  </span>{" "}
                                  {b.subPlan.prompt}
                                </p>
                              )}
                              {b.subPlan?.steps?.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {b.subPlan.steps.length} sub-plan steps
                                </p>
                              )}
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* structured editable checklist — the machine-readable plan steps, at the bottom */}
        {showChecklist && (
          <PlanSteps
            flowId={flow.id}
            steps={planSteps}
            editable={awaiting}
            action={action}
          />
        )}
        </div>
      </ScrollArea>

      {/* fixed footer */}
      {awaiting && isCurrent ? (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0">
          {/* plan fan-out (§1): the published execution resolution at approve,
              with the override control (Phase 3B) — forcing whole/steps at
              approve records executionSource "override" in the plan version's
              plan-meta and a downstream from-plan fan-out node honors it */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] text-muted-foreground whitespace-nowrap">
              will execute:
            </span>
            <div className="flex overflow-hidden rounded-lg border border-border text-[12px] shrink-0">
              {(["whole", "steps"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={
                    execPick === v
                      ? "px-2.5 py-1 bg-info/10 text-info"
                      : "px-2.5 py-1 text-muted-foreground hover:text-foreground"
                  }
                  title={v === "whole"
                    ? "Force the whole plan into one run"
                    : `Force step-by-step execution (${planSteps.length} step${planSteps.length === 1 ? "" : "s"})`}
                  onClick={() => setExecPick(v)}
                >
                  {v === execPick
                    ? executionNote
                    : v === "whole"
                      ? "one run"
                      : "step-by-step"}
                </button>
              ))}
            </div>
          </div>
          {(plannerRationale && knobExecution === "follow") && (
            <span className="text-[11.5px] text-muted-foreground truncate min-w-0" title={plannerRationale}>
              planner: “{plannerRationale}”
            </span>
          )}
          {publishedSource === "override" && (
            <span className="text-[11.5px] text-muted-foreground shrink-0">
              (overridden at the last approve)
            </span>
          )}
          <div className="flex-1" />
          <Button
            variant="default"
            onClick={() => action("approve_plan", {
              ...(execPick !== published ? { executionOverride: execPick } : {}),
            })}
          >
            <Check size={15} /> Approve plan
          </Button>
        </div>
      ) : null}

      {showPrompt && (
        <PromptModal
          flowId={flow.id}
          nodeKey="plan"
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          onRun={(prompt, promptIsBody) => {
            runWithPrompt(prompt, promptIsBody);
            setShowPrompt(false);
          }}
        />
      )}

      {refineBranch && (
        <PromptModal
          flowId={flow.id}
          nodeKey="plan"
          branch={refineBranch}
          open={Boolean(refineBranch)}
          onClose={() => setRefineBranch(null)}
          onRun={(prompt, promptIsBody, extras) => {
            runBranchRefine(prompt, promptIsBody, extras);
            setRefineBranch(null);
          }}
          showContextPicker
          defaultFresh={freshScoped}
          hasAgent={Boolean(node.agent_id)}
        />
      )}
    </div>
  );
}

// registered with the panel registry (§3.1) — served by the builtin plan key
registerPanel({ type: "plan" }, PlanView);
