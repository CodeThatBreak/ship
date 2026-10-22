"use client";
import { useMemo, useState } from "react";
import { Compass, Check, GitBranch, FileCode, ListChecks, Layers, AlertTriangle, RotateCcw, Pencil, Info, Square, Braces, ChevronDown, ChevronRight, Plus, Minus, ArrowRightLeft } from "lucide-react";
import type { FlowData, Node, Artifact } from "../app/flows/[id]/page";
import Markdown from "./Markdown";
import ModelSelect from "./ModelSelect";
import PlanSteps from "./PlanSteps";
import PromptModal, { type PromptRunExtras } from "./PromptModal";
import { VersionTabs, ArtifactLoader, CostChip } from "./NodePanel";
import { Alert } from "./ui/alert";
import { Badge, BadgeDot } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Spinner } from "./ui/spinner";
import { Tooltip } from "./ui/tooltip";

// ── branch step diff (client copy of the engine's id-based classifier) ──────

interface DiffStep { id: string; title: string; detail?: string; files?: string[] }
interface BranchStepDiff {
  added: DiffStep[];
  removed: DiffStep[];
  changed: { id: string; before: DiffStep; after: DiffStep }[];
}

const contentEqual = (a: DiffStep, b: DiffStep) =>
  a.title === b.title && a.detail === b.detail && JSON.stringify(a.files ?? []) === JSON.stringify(b.files ?? []);

/** Id-based diff with a title fallback — merge preserves ids for unchanged steps, so ids mean identity. */
function diffBranchSteps(oldSteps: DiffStep[], newSteps: DiffStep[]): BranchStepDiff {
  const byId = (arr: DiffStep[]) => new Map(arr.filter((s) => s.id).map((s) => [s.id, s]));
  const oldById = byId(oldSteps);
  const newById = byId(newSteps);

  const added: DiffStep[] = [];
  const changed: { id: string; before: DiffStep; after: DiffStep }[] = [];
  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) added.push(next);
    else if (!contentEqual(prev, next)) changed.push({ id, before: prev, after: next });
  }
  const leftoversOld = [...oldById.values()].filter((s) => !newById.has(s.id!));
  const removed: DiffStep[] = [];
  for (const o of leftoversOld) {
    // agents occasionally rename ids on unchanged steps — promote title matches
    const idx = added.findIndex((n) => n.title === o.title && contentEqual(o, n));
    if (idx >= 0) {
      changed.push({ id: `${o.id} → ${added[idx].id}`, before: o, after: added[idx] });
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
function latestScopedRefineVersion(arts: Artifact[], branchName: string): number {
  let v = 0;
  for (const a of arts) {
    const sr = a.meta?.scopedRefine;
    if (sr?.branch === branchName && typeof sr.from === "number" && a.version > v) v = a.version;
  }
  return v;
}

export default function PlanView({ flow, node, action, fetchArtifact }:
  { flow: FlowData; node: Node; action: (a: string, b?: any) => void; fetchArtifact: (id: string) => Promise<any> }) {
  const plans = node.artifacts.filter((a: Artifact) => a.kind === "plan");
  const [sel, setSel] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [decompose, setDecompose] = useState(false);
  const [complex, setComplex] = useState(false);
  const [model, setModel] = useState("");
  // branch-scoped refine state (§7.1): which branch is being refined + the open tab
  const [refineBranch, setRefineBranch] = useState<string | null>(null);
  const [openBranchTab, setOpenBranchTab] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [freshScoped, setFreshScoped] = useState(true);
  const current = plans.find((a) => a.id === sel) ?? plans[plans.length - 1];
  const awaiting = node.status === "awaiting_approval";
  const running = node.status === "running";
  const isCurrent = current && current.id === plans[plans.length - 1]?.id;

  // Phase 3A: extract branches from the plan output or artifact meta
  const branches = node.output?.branches ?? null;
  // structured checklist (live rows; editable until the plan is approved)
  const planSteps = flow.planSteps ?? [];
  const showChecklist = planSteps.length > 0 || awaiting || node.status === "approved";

  const statusVariant =
    node.status === "approved" ? "green"
    : node.status === "running" ? "blue"
    : node.status === "awaiting_approval" ? "amber"
    : node.status === "failed" ? "red" : "default";

  // malformed plan-meta: the agent returned a plan but the structured block
  // failed validation even after the automatic retry
  const malformed = node.output?.malformed === true;
  const validationErrors: { path: string; message: string }[] = node.output?.validationErrors ?? [];

  const startPlan = (prompt?: string, promptIsBody?: boolean) =>
    action("start_plan", { prompt, promptIsBody: promptIsBody || undefined, decompose: decompose || undefined, model: model || undefined, complex: complex || undefined });

  // Edit prompt runs a fresh plan when none exists yet; once a plan exists it
  // reruns as a refinement of the current one.
  const runWithPrompt = (prompt: string, promptIsBody: boolean) => {
    if (plans.length > 0) {
      action("refine_plan", { feedback: "", prompt, promptIsBody: promptIsBody || undefined, model: model || undefined, complex: complex || undefined });
    } else {
      startPlan(prompt, promptIsBody);
    }
  };

  // Branch-scoped sub-plan refine (§7.1): promptIsBody — the modal returns the
  // developer-editable body; the engine appends the internal scoped rules.
  const runBranchRefine = (prompt: string, promptIsBody: boolean, extras: PromptRunExtras) => {
    if (!refineBranch) return;
    action("refine_plan", {
      prompt, promptIsBody: promptIsBody || undefined,
      complex: true, branchRef: refineBranch,
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
    const pick = (meta: any) => (meta.steps as any[]).filter((s) => s.branch === branch);
    const diff = diffBranchSteps(pick(prev.meta), pick(latest.meta));
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) return null;
    return { branch, from: sr.from as number, to: latest.version, diff };
  }, [plans]);

  const openBranch = branches?.find((b: any) => b.name === openBranchTab) ?? null;

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
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-soft shrink-0">
        <h2 className="m-0 text-[15px]">Implementation plan</h2>
        <Badge variant={statusVariant as any}>
          <BadgeDot />
          {node.status.replace(/_/g, " ")}
        </Badge>
        <CostChip node={node} />
        <div className="flex-1" />
        <ModelSelect value={model} onChange={setModel} />
        <Button size="sm" variant="ghost" onClick={() => setShowPrompt(true)}>
          <Pencil size={12} /> Edit prompt
        </Button>
      </div>

      {/* scrollable content */}
      <div className="scroll flex-1 min-h-0 px-5 py-4">
        {node.status === "failed" && (
          <Alert variant="red" className="mb-3.5">
            <AlertTriangle size={16} className="shrink-0" />
            <div className="flex-1">
              {malformed ? (
                <>
                  <span className="font-medium">Malformed plan response</span>
                  <p className="text-xs mt-1 mb-0">
                    The agent generated a plan but the structured plan-meta block failed validation.
                    {validationErrors.length > 0 && (
                      <ul className="mt-1.5 ml-3 list-disc text-xs text-red/80">
                        {validationErrors.map((e, i) => (
                          <li key={i}>{e.path ? `${e.path}: ` : ""}{e.message}</li>
                        ))}
                      </ul>
                    )}
                  </p>
                </>
              ) : (
                <span>This step failed — check the activity feed for details.</span>
              )}
            </div>
            <Button size="sm" onClick={() => action("retry", { nodeKey: node.node_key })}>
              <RotateCcw size={13} /> Retry
            </Button>
          </Alert>
        )}

        {plans.length === 0 && node.status === "pending" && (
          <div className="text-center px-5 py-16">
            <Compass size={32} className="text-muted mb-3 mx-auto" />
            <p className="text-muted max-w-[380px] mx-auto">
              Generate an implementation plan from the ticket PRD, Figma links, and the repository.
            </p>
          </div>
        )}

        {running && (
          <div className="flex flex-col items-center justify-center text-center px-5 py-20 gap-3">
            <Spinner className="size-[22px] border-[3px]" />
            <p className="text-text-dim text-sm font-medium m-0">
              {plans.length === 0 ? "Agent is cooking up the plan…" : "Agent is reworking the plan…"}
            </p>
            <p className="text-muted text-xs m-0">Grabbing coffee while it reads the repo — watch the activity feed →</p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => action("cancel", { nodeKey: node.node_key })}>
              <Square size={12} /> Stop agent
            </Button>
          </div>
        )}

        {plans.length > 1 && <VersionTabs arts={plans} sel={current?.id} onSel={setSel} />}

        {/* structured editable checklist — the machine-readable plan steps */}
        {showChecklist && (
          <PlanSteps flowId={flow.id} steps={planSteps} editable={awaiting} action={action} />
        )}

        {/* branch cards → expandable tabs (§8) */}
        {branches && branches.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <GitBranch size={14} /> {branches.length} branch{branches.length > 1 ? "es" : ""} planned
            </h3>

            {/* scoped-refine diff banner (§7.3) */}
            {scopedDiff && (
              <Card className="px-3.5 py-2.5 mb-2">
                <button
                  className="w-full flex items-center gap-2 text-left text-xs"
                  onClick={() => setShowDiff((v) => !v)}
                >
                  <Badge variant="purple" className="shrink-0"><ArrowRightLeft size={10} /> {scopedDiff.branch}</Badge>
                  <span className="text-muted">
                    sub-plan refined (v{scopedDiff.from} → v{scopedDiff.to}) ·{" "}
                    {[
                      scopedDiff.diff.changed.length ? `${scopedDiff.diff.changed.length} step${scopedDiff.diff.changed.length > 1 ? "s" : ""} changed` : null,
                      scopedDiff.diff.added.length ? `${scopedDiff.diff.added.length} added` : null,
                      scopedDiff.diff.removed.length ? `${scopedDiff.diff.removed.length} removed` : null,
                    ].filter(Boolean).join(", ")}
                  </span>
                  <span className="flex-1" />
                  <span className="text-accent">{showDiff ? "hide diff" : "view diff"}</span>
                  {showDiff ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                {showDiff && (
                  <div className="mt-2 border-t border-border-soft pt-2 grid gap-1">
                    {scopedDiff.diff.removed.map((s: DiffStep) => (
                      <DiffRow key={`rm-${s.id}`} kind="removed" text={`${s.id}: ${s.title}`} sub={s.detail} />
                    ))}
                    {scopedDiff.diff.changed.map((c) => (
                      <DiffRow
                        key={`ch-${c.id}`}
                        kind="changed"
                        text={`${c.id}: ${c.after.title}`}
                        sub={c.after.detail}
                        before={`${c.before.id}: ${c.before.title}`}
                        beforeSub={c.before.detail}
                      />
                    ))}
                    {scopedDiff.diff.added.map((s: DiffStep) => (
                      <DiffRow key={`ad-${s.id}`} kind="added" text={`${s.id}: ${s.title}`} sub={s.detail} />
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* staleness note above the overview when any branch doc is newer (§8) */}
            {hasStaleBranches && (
              <p className="text-[11.5px] text-muted mb-2 flex items-start gap-1.5">
                <Info size={12} className="shrink-0 mt-[1px]" />
                branch sub-plans are more recent than this overview — open a branch tab for its current document
              </p>
            )}

            <div className="grid gap-2">
              {branches.map((b: any) => {
                const staleV = staleBranches.get(b.name);
                const expanded = openBranchTab === b.name;
                return (
                  <Card key={b.name} className="px-4 py-3">
                    <button
                      className="w-full flex items-center gap-2 mb-1 text-left"
                      onClick={() => setOpenBranchTab(expanded ? null : b.name)}
                    >
                      {expanded ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
                      <Badge variant="blue">{b.name}</Badge>
                      <span className="font-medium text-sm">{b.title}</span>
                      {b.subPlan && <Badge variant="purple">sub-plan</Badge>}
                      {b.markdown && <Badge variant="green">branch doc</Badge>}
                      {staleV && (
                        <Tooltip content={`This branch's document was refined by a scoped run (v${staleV}) newer than the overview you're viewing`}>
                          <Badge variant="amber">● sub-plan refined v{staleV}</Badge>
                        </Tooltip>
                      )}
                      {b.dependsOn?.length > 0 && (
                        <span className="text-xs text-muted">depends on: {b.dependsOn.join(", ")}</span>
                      )}
                    </button>
                    {b.scope && <p className="text-xs text-muted mb-1.5">{b.scope}</p>}
                    <div className="flex gap-3 text-xs text-muted items-center">
                      <span className="flex items-center gap-1"><FileCode size={11} /> {b.files?.length ?? 0} files</span>
                      <span className="flex items-center gap-1"><ListChecks size={11} /> {b.steps?.length ?? 0} steps</span>
                      <div className="flex-1" />
                      {awaiting && isCurrent && (
                        <Tooltip content="Refine ONLY this branch's sub-plan — the agent rewrites one branch, not the whole plan; everything else stays untouched">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRefineBranch(b.name);
                              setFreshScoped(true); // scoped refines default to a fresh agent (§3)
                              setOpenBranchTab(null);
                            }}
                          >
                            <Pencil size={11} /> Refine sub-plan
                          </Button>
                        </Tooltip>
                      )}
                    </div>

                    {expanded && (
                      <div className="mt-2 pt-2 border-t border-border-soft">
                        {b.markdown ? (
                          <Card className="md px-[18px] py-1 pb-3.5">
                            <Markdown text={b.markdown} />
                          </Card>
                        ) : (
                          <div className="px-1">
                            <p className="text-xs text-muted mb-1.5">
                              No branch document yet — refined sub-plans write one. The plan overview still covers this branch.
                            </p>
                            {b.subPlan?.prompt && (
                              <p className="text-xs text-muted mb-1">
                                <span className="text-text-dim">Sub-plan prompt:</span> {b.subPlan.prompt}
                              </p>
                            )}
                            {b.subPlan?.steps?.length > 0 && (
                              <p className="text-xs text-muted">{b.subPlan.steps.length} sub-plan steps</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {current && !openBranch && (
          <ArtifactLoader id={current.id} fetchArtifact={fetchArtifact}
            render={(a: any) => (
              <div>
                {a.meta?.feedback && (
                  <div className="text-xs text-muted border-l-[3px] border-purple pl-2.5 mb-3">
                    Refined from feedback: "{a.meta.feedback}"
                  </div>
                )}
                <Card className="md px-[18px] py-1 pb-3.5">
                  <Markdown text={a.content} />
                </Card>
              </div>
            )} />
        )}

        {awaiting && isCurrent && (
          <p className="text-muted text-xs mt-4 mb-0">
            Want changes? Refine the plan from the chat on the right →
          </p>
        )}
      </div>

      {/* fixed footer */}
      {(plans.length === 0 && node.status === "pending") || (awaiting && isCurrent) ? (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border-soft shrink-0">
          {plans.length === 0 && node.status === "pending" ? (
            <>
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                <Checkbox checked={decompose} onCheckedChange={(v) => setDecompose(v === true)} />
                <Layers size={13} /> Decompose
              </label>
              <Tooltip
                content={
                  flow.execution_mode === "local"
                    ? "Use built-in Task subagents to explore different areas of the repo in parallel, then merge the results into a single cohesive plan."
                    : "Delegate exploration of different repo areas to sub-agents, then merge the results into a single cohesive plan."
                }
              >
                <Info size={13} className="text-muted hover:text-text-dim cursor-help" />
              </Tooltip>
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                <Checkbox checked={complex} onCheckedChange={(v) => setComplex(v === true)} />
                <Braces size={13} /> Complex plan
              </label>
              <Tooltip
                content="For bigger tickets with multiple parts: the agent returns JSON with markdown plan + steps + branches + sub-plans. Each branch can have its own sub-plan for a dedicated planning run."
              >
                <Info size={13} className="text-muted hover:text-text-dim cursor-help" />
              </Tooltip>
              <div className="flex-1" />
              <Button variant="primary" onClick={() => startPlan()}>
                <Compass size={15} /> Generate plan
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted">Ready to build?</span>
              <div className="flex-1" />
              <Button variant="success" onClick={() => action("approve_plan")}>
                <Check size={15} /> {branches?.length > 1 ? `Approve all ${branches.length} branches & start build` : "Approve plan & start build"}
              </Button>
            </>
          )}
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

/** One old-vs-new step row in the expandable diff banner. */
function DiffRow({ kind, text, sub, before, beforeSub }:
  { kind: "added" | "removed" | "changed"; text: string; sub?: string; before?: string; beforeSub?: string }) {
  const icon =
    kind === "added" ? <Plus size={11} className="text-green shrink-0" />
    : kind === "removed" ? <Minus size={11} className="text-red shrink-0" />
    : <ArrowRightLeft size={11} className="text-amber shrink-0" />;
  return (
    <div className="flex items-start gap-2 text-[12px]">
      {icon}
      {before != null && (
        <span className="text-muted line-through decoration-red/60 min-w-0">
          {before}{beforeSub ? ` — ${beforeSub}` : ""}
        </span>
      )}
      {before != null && <ArrowRightLeft size={10} className="text-muted shrink-0 mt-[2px]" />}
      <span className={kind === "removed" ? "text-muted line-through min-w-0" : "min-w-0"}>
        {text}{sub ? ` — ${sub}` : ""}
      </span>
    </div>
  );
}
