"use client";
import { useState } from "react";
import { Lock, X, Play, Info, Bot } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useFlowPrompt } from "@/hooks/use-flow-prompt";
import { useToggledSections } from "./hooks/use-toggled-sections";
import { ContextPicker } from "./ContextPicker";
import { FinalPromptFooter } from "./FinalPromptFooter";
import { LockedSection } from "./LockedSection";
import { PromptEditorSection } from "./PromptEditorSection";
import { PromptModalSkeleton } from "./PromptModalSkeleton";
import { RulesSection } from "./RulesSection";

// the prompt-modal types moved to the data hook (hooks/use-flow-prompt.ts) —
// re-exported here for the consumers that imported them from this file
export type { ContextBlockInfo, PromptData, RunDataBlock } from "@/hooks/use-flow-prompt";

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
  const {
    edited,
    setEdited,
    rules,
    setRules,
    promptTextareaRef,
    selectedBlocks,
    setSelectedBlocks,
    rulesSaved,
    rulesError,
    setRulesSaved,
    data,
    finalPrompt,
    seedPending,
    seedError,
    refetch,
    savingRules,
    saveRules,
  } = useFlowPrompt({
    open,
    flowId,
    nodeKey,
    feedback,
    instructions,
    branch,
    showContextPicker,
  });
  const [finalOpen, setFinalOpen] = useState(false);
  const [fresh, setFresh] = useState(defaultFresh ?? false);
  const [openSections, toggleSection] = useToggledSections();

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
      {seedPending ? (
        <PromptModalSkeleton />
      ) : seedError || !data ? (
        <div className="grid gap-2">
          <p className="text-muted-foreground m-0">Failed to load prompt.</p>
          <Button variant="outline" size="sm" className="self-start" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-muted-foreground text-[12.5px] m-0">{data.description}</p>

          {/* ── part 1: your prompt ─────────────────────────────────────────── */}
          <PromptEditorSection
            variables={data.variables}
            edited={edited}
            onEditedChange={setEdited}
            onInsertVariable={insertVariable}
            textareaRef={promptTextareaRef}
            fromTemplateConfig={data.bodySource === "config"}
          />

          {/* ── part 2: rules (engine rules locked + your rules editable) ───── */}
          {showRules && (
            <RulesSection
              open={openSections.has("rules")}
              onToggle={() => toggleSection("rules")}
              engineRules={data.engineRules}
              rules={rules}
              onRulesChange={(v) => {
                setRules(v);
                setRulesSaved(false);
              }}
              onSaveRules={() => saveRules({ rules, rulesKey: data.rulesKey })}
              savingRules={savingRules}
              rulesSaved={rulesSaved}
              rulesError={rulesError}
              rulesDirty={rulesDirty}
            />
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
              badge={<>locked · live</>}
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
            <ContextPicker
              blocks={blocks}
              selectedBlocks={selectedBlocks}
              totalContextChars={totalContextChars}
              onToggleBlock={(id) =>
                setSelectedBlocks((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
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

          <FinalPromptFooter
            charCount={charCount}
            isOverride={isOverride}
            showFinal={showFinal}
            finalOpen={finalOpen}
            onToggleFinal={() => setFinalOpen((s) => !s)}
            canReset={edited === data.prompt}
            onReset={() => setEdited(data.prompt)}
            final={finalPrompt}
          />
        </div>
      )}
    </Modal>
  );

  /** Insert a `{{variable}}` at the caret, then restore focus behind it. */
  function insertVariable(v: string) {
    const ta = promptTextareaRef.current;
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
  }
}
