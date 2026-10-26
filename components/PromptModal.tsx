"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Lock, RotateCcw, Play, X, Info, Bot, Save, ScrollText } from "lucide-react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Textarea } from "./ui/textarea";
import { cn } from "../lib/utils";

interface RunDataBlock {
  kind: "rules" | "contract" | "data";
  text: string;
}

interface PromptData {
  prompt: string;
  label: string;
  description: string;
  variables: string[];
  mode: string;
  source: string;
  /** internal instructions were stripped from `prompt` and are re-appended at run time */
  appendsInternal?: boolean;
  /** where the body came from: the node's config (`prompt_body`) or the built-in default */
  bodySource?: "config" | "default";
  /** the user's standing rules (the config knob named by `rulesKey`) */
  userRules?: string;
  /** engine-authored rules — locked, appended at run time */
  engineRules?: string;
  /** the machine-parsed output contract — locked, appended at run time */
  outputContract?: string;
  /** live run-data blocks (context, diffs, logs, comments) — finalized at run time */
  runData?: RunDataBlock[];
  /** exactly what the agent will receive */
  final?: string;
  /** the node config key the rules box saves into (`prompt_rules` / `fix_prompt_rules`) */
  rulesKey?: string;
  /** context blocks for the picker (sub-plan refine prompts, §4/§7.5) */
  contextBlocks?: ContextBlockInfo[];
}

export interface ContextBlockInfo {
  id: string;
  label: string;
  description: string;
  /** rendered preview — what the model would see for this block */
  text: string;
  chars: number;
  defaultOn: boolean;
  locked: boolean;
}

export interface PromptRunExtras {
  /** start a clean agent instead of following up on the node's existing one */
  fresh?: boolean;
  /** ids of the context blocks to assemble server-side into {{context}} */
  contextBlocks?: string[];
}

export default function PromptModal({
  flowId,
  nodeKey,
  open,
  onClose,
  onRun,
  feedback,
  instructions,
  branch,
  showContextPicker,
  defaultFresh,
  hasAgent,
}: {
  flowId: string;
  nodeKey: string;
  open: boolean;
  onClose: () => void;
  onRun: (prompt: string, promptIsBody: boolean, extras: PromptRunExtras) => void;
  feedback?: string;
  instructions?: string;
  /** seed a branch-scoped sub-plan refine prompt (?branch=) */
  branch?: string;
  /** show the context block picker (scoped refines — the picker controls everything a fresh agent sees) */
  showContextPicker?: boolean;
  /** initial state of the "New agent" checkbox (scoped refines default fresh) */
  defaultFresh?: boolean;
  /** hide the fresh toggle when no agent exists yet — the first run is always fresh */
  hasAgent?: boolean;
}) {
  const [data, setData] = useState<PromptData | null>(null);
  const [edited, setEdited] = useState("");
  const [rules, setRules] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [savingRules, setSavingRules] = useState(false);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [finalOpen, setFinalOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState(defaultFresh ?? false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(false);
    setRulesSaved(false);
    setRulesError(null);
    const params = new URLSearchParams({ node: nodeKey });
    if (feedback) params.set("feedback", feedback);
    if (instructions) params.set("instructions", instructions);
    if (branch) params.set("branch", branch);
    fetch(`/api/flows/${flowId}/prompt?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PromptData) => {
        setData(d);
        setEdited(d.prompt ?? "");
        setRules(d.userRules ?? "");
        const defaults = new Set<string>();
        for (const b of d.contextBlocks ?? []) {
          if (b.defaultOn || b.locked) defaults.add(b.id);
        }
        setSelectedBlocks(defaults);
        setLoading(false);
      })
      .catch(() => {
        setData(null);
        setLoading(false);
        setLoadError(true);
      });
  }, [open, flowId, nodeKey, feedback, instructions, branch, reloadKey]);

  // the final preview must match the context-block selection (scoped refine):
  // refetch the sections with the picked block ids — WITHOUT re-seeding the
  // body, rules or the picker itself (that would clobber the user's edits)
  const selectionKey = showContextPicker ? [...selectedBlocks].sort().join(",") : "";
  const promptLoaded = data != null && !loading && !loadError;
  useEffect(() => {
    if (!open || !showContextPicker || !promptLoaded) return;
    const params = new URLSearchParams({ node: nodeKey });
    if (branch) params.set("branch", branch);
    if (selectionKey) params.set("contextBlocks", selectionKey);
    let alive = true;
    fetch(`/api/flows/${flowId}/prompt?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PromptData) => {
        if (!alive) return;
        setData((prev) => (prev ? { ...prev, final: d.final, runData: d.runData, outputContract: d.outputContract, engineRules: d.engineRules } : prev));
      })
      .catch(() => { /* keep the previous preview */ });
    return () => { alive = false; };
  }, [open, flowId, nodeKey, branch, showContextPicker, selectionKey, promptLoaded]);

  const insertVariable = (v: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? edited.length;
    const before = edited.slice(0, pos);
    const after = edited.slice(pos);
    const insert = `{{${v}}}`;
    setEdited(before + insert + after);
    // Restore cursor after the inserted text
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + insert.length;
    });
  };

  const resetToTemplate = () => {
    if (data) setEdited(data.prompt);
  };

  /** Persist the rules box to the node's config (the `rulesKey` knob) so every
   *  later run — modal or engine-triggered — assembles the same prompt. */
  const saveRules = async () => {
    setSavingRules(true);
    setRulesError(null);
    setRulesSaved(false);
    try {
      const r = await fetch(`/api/flows/${flowId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_node_config",
          nodeKey,
          config: { [data?.rulesKey ?? "prompt_rules"]: rules.trim() || null },
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        throw new Error(d?.error ?? `HTTP ${r.status}`);
      }
      setRulesSaved(true);
      setReloadKey((k) => k + 1); // refetch so the final preview reflects the saved rules
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRules(false);
    }
  };

  const toggleBlock = (id: string, locked: boolean) => {
    if (locked) return; // pinned: the engine includes it regardless
    setSelectedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSection = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const charCount = edited.length;
  const blocks = data?.contextBlocks ?? [];
  // locked blocks are always included — count them in the total
  const totalContextChars = blocks
    .filter((b) => selectedBlocks.has(b.id) || b.locked)
    .reduce((sum, b) => sum + b.chars, 0);
  const selectedIds = blocks.filter((b) => selectedBlocks.has(b.id) || b.locked).map((b) => b.id);
  const isOverride = data?.source === "override";
  const rulesDirty = data != null && rules !== (data.userRules ?? "");
  // the rules editor shows for every template-owned prompt (user rules apply
  // on every run, refine and build included); the locked sections only when
  // the template actually carries them
  const showRules = !isOverride;
  const showContract = !isOverride && (data?.outputContract?.trim().length ?? 0) > 0;
  const showRunData = !isOverride && (data?.runData?.length ?? 0) > 0;
  const showFinal = !isOverride;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data ? `Edit prompt — ${data.label}` : "Edit prompt"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            <X size={14} /> Cancel
          </Button>
          <Button
            onClick={() =>
              onRun(edited, Boolean(data?.appendsInternal), {
                fresh: hasAgent ? fresh : undefined,
                contextBlocks: showContextPicker ? selectedIds : undefined,
              })
            }
            disabled={!edited.trim()}
          >
            <Play size={14} /> Run with this prompt
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="grid gap-2">
          <p className="text-muted-foreground"><Spinner /> Loading prompt…</p>
        </div>
      ) : loadError || !data ? (
        <div className="grid gap-2">
          <p className="text-muted-foreground m-0">Failed to load prompt.</p>
          <Button variant="outline" size="sm" className="self-start" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-muted-foreground text-[12.5px] m-0">{data.description}</p>

          {/* ── part 1: your prompt ─────────────────────────────────────────── */}
          {data.variables.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[11px] text-muted-foreground uppercase tracking-[0.5px] mr-1">Insert:</span>
              {data.variables.map((v) => (
                <Badge
                  key={v}
                  className="cursor-pointer hover:border-info hover:text-info transition-colors"
                  onClick={() => insertVariable(v)}
                >
                  {`{{${v}}}`}
                </Badge>
              ))}
            </div>
          )}

          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Your prompt</span>
              {data.bodySource === "config" && (
                <Badge className="bg-info/10 text-info">from template config</Badge>
              )}
            </div>
            <Textarea
              ref={textareaRef}
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              className="w-full bg-background border-border rounded-lg px-3.5 py-3 text-[12.5px] font-mono leading-relaxed resize-y min-h-[200px]"
              rows={12}
            />
          </div>

          {/* ── part 2: rules (engine rules locked + your rules editable) ───── */}
          {showRules && (
            <LockedSection
              title="Rules"
              badge={<>built-in <Lock size={10} /> + yours</>}
              open={openSections.has("rules")}
              onToggle={() => toggleSection("rules")}
              lockedText={data.engineRules}
              lockedEmpty="No built-in rules for this template."
            >
              <div className="grid gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Your rules</span>
                  <span className="text-[11px] text-muted-foreground">
                    appended after your prompt, before the locked blocks — saved to this node&apos;s config
                  </span>
                </div>
                <Textarea
                  value={rules}
                  onChange={(e) => {
                    setRules(e.target.value);
                    setRulesSaved(false);
                  }}
                  placeholder="e.g. always ask before assuming a framework; prefer the smallest diff that fixes the issue"
                  className="w-full bg-background border-border rounded-lg px-3 py-2 text-[12px] font-mono leading-relaxed resize-y min-h-[60px]"
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void saveRules()}
                    disabled={savingRules || !rulesDirty}
                  >
                    {savingRules ? <Spinner /> : <Save size={12} />} Save rules
                  </Button>
                  {rulesSaved && <span className="text-[11px] text-success">saved — applies to every run</span>}
                  {rulesError && <span className="text-[11px] text-destructive">{rulesError}</span>}
                  {rulesDirty && !rulesError && (
                    <span className="text-[11px] text-muted-foreground">
                      unsaved — run uses the saved rules{rules.trim() === "" ? " (none)" : ""}
                    </span>
                  )}
                </div>
              </div>
            </LockedSection>
          )}

          {/* ── part 3: output contract (locked) ────────────────────────────── */}
          {showContract && (
            <LockedSection
              title="Output contract"
              badge={<><Lock size={10} /> locked</>}
              open={openSections.has("contract")}
              onToggle={() => toggleSection("contract")}
              lockedText={data.outputContract}
              lockedEmpty="No output contract for this template."
              note="The engine re-appends this at run time — the code parses this exact format, so it can't be edited."
            />
          )}

          {/* ── run data (locked, live) ─────────────────────────────────────── */}
          {showRunData && (
            <LockedSection
              title="Run data"
              badge={<><Lock size={10} /> locked · live</>}
              open={openSections.has("runData")}
              onToggle={() => toggleSection("runData")}
              lockedText={(data.runData ?? []).map((b) => b.text || "(finalized at run time)").join("\n\n")}
              lockedEmpty=""
            />
          )}

          {data.appendsInternal && (
            <p className="text-muted-foreground text-[12px] m-0 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-[1px]" />
              <span>
                Only the editable part is shown — the locked rules, output contract and live run
                data below are added automatically when the prompt runs. Toggle
                &ldquo;Show final prompt&rdquo; to see the exact text.
              </span>
            </p>
          )}

          {/* context picker — what the model sees, per block char counts. For a
              fresh agent this controls EVERYTHING the model sees. */}
          {showContextPicker && blocks.length > 0 && (
            <div className="border border-border rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Context blocks</span>
                <span className="text-[11px] text-muted-foreground" title="Total size of the context the model will see">
                  {totalContextChars.toLocaleString()} chars
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <Info size={12} className="text-muted-foreground hover:text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    What the model will receive. Context is finalized when the agent runs — this selection is a guide. A fresh agent sees exactly these blocks, nothing else.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="grid gap-1.5">
                {blocks.map((b) => (
                  <label
                    key={b.id}
                    className={cn(
                      "flex items-start gap-2 text-[12.5px] rounded-lg px-2 py-1.5 transition-colors",
                      b.locked ? "opacity-70 cursor-not-allowed" : "cursor-pointer hover:bg-background"
                    )}
                    title={b.text ? b.text : undefined}
                  >
                    <Checkbox
                      className="shrink-0 mt-[1px]"
                      checked={selectedBlocks.has(b.id) || b.locked}
                      disabled={b.locked}
                      onCheckedChange={() => toggleBlock(b.id, b.locked)}
                    />
                    <span className="flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium">{b.label}</span>
                        {b.locked && (
                          <Tooltip>
                            <TooltipTrigger>
                              <span className="inline-flex items-center gap-1 text-[10.5px] text-warning"><Lock size={10} /> locked</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Locked: the branch scope, files and dependencies are the contract a scoped refine works inside — the engine always includes it.
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <span className="text-[11px] text-muted-foreground">{b.chars.toLocaleString()} chars</span>
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">{b.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {hasAgent && (
            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer select-none">
              <Checkbox className="shrink-0 mt-[1px]" checked={fresh} onCheckedChange={(v) => setFresh(v === true)} />
              <span className="flex flex-col">
                <span className="flex items-center gap-1.5 font-medium"><Bot size={12} /> New agent</span>
                <span className="text-[11.5px] text-muted-foreground">
                  start a clean agent instead of continuing the current one — lower hallucination risk from
                  accumulated context; it only re-reads this branch&apos;s files
                </span>
              </span>
            </label>
          )}

          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>{charCount.toLocaleString()} chars</span>
            {isOverride && <Badge className="bg-warning/10 text-warning">custom override</Badge>}
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setFinalOpen((s) => !s)}>
              <ScrollText size={12} /> {finalOpen ? "Hide final prompt" : "Show final prompt"}
            </Button>
            <Button size="sm" onClick={resetToTemplate} disabled={edited === data.prompt}>
              <RotateCcw size={12} /> Reset to template
            </Button>
          </div>

          {showFinal && finalOpen && (
            <div className="grid gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Final prompt</span>
                <span className="text-[11px] text-muted-foreground">
                  {(data.final?.length ?? 0).toLocaleString()} chars — what the agent receives; live data (context, diffs, logs) finalizes at run time
                </span>
              </div>
              <pre className="text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap m-0 max-h-72 overflow-y-auto">
                {data.final || "(empty)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * One collapsible locked part of the prompt (rules / output contract / run
 * data): a header row with a chevron, an optional editable child (the rules
 * box), and the locked text in a read-only block when expanded.
 */
function LockedSection({
  title,
  badge,
  open,
  onToggle,
  lockedText,
  lockedEmpty,
  note,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  lockedText?: string;
  lockedEmpty: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg px-3 py-2.5 grid gap-2">
      <button
        type="button"
        className="flex items-center gap-2 text-left cursor-pointer select-none"
        onClick={onToggle}
        aria-expanded={open}
      >
        <ChevronDown size={13} className={cn("text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">{title}</span>
        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">{badge}</span>
        {lockedText != null && lockedText.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{lockedText.length.toLocaleString()} chars</span>
        )}
      </button>
      {children}
      {open && (
        <div className="grid gap-1">
          {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
          <pre className="text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground m-0 max-h-56 overflow-y-auto rounded-lg bg-muted/40 px-2.5 py-2">
            {lockedText?.trim() ? lockedText : lockedEmpty}
          </pre>
        </div>
      )}
    </div>
  );
}
