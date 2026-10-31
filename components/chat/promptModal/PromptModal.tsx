"use client";
import { useState } from "react";
import { Lock, X, Play, Info } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useFlowPrompt } from "../hooks/useFlowPrompt";
import { useToggledSections } from "./hooks/useToggledSections";
import { FinalPromptFooter } from "./FinalPromptFooter";
import { LockedSection } from "./LockedSection";
import { PromptEditorSection } from "./PromptEditorSection";
import { PromptModalSkeleton } from "./PromptModalSkeleton";
import { RulesSection } from "./RulesSection";

export type { PromptData, RunDataBlock } from "../hooks/useFlowPrompt";

/**
 * The prompt editor modal (review/resolve/pipeline, docs/plan-conversation-
 * refine.md §4d scope guard): the three-part prompt view + the rules editor.
 * The plan node no longer uses a modal — its inputs live in the chat
 * composer's states; the branch-scoped prefill / context picker machinery
 * was deleted with them.
 */
export default function PromptModal({
  flowId,
  nodeKey,
  open,
  onClose,
  onRun,
  instructions,
}: {
  flowId: string;
  nodeKey: string;
  open: boolean;
  onClose: () => void;
  onRun: (prompt: string, promptIsBody: boolean) => void;
  instructions?: string;
}) {
  const {
    edited,
    setEdited,
    rules,
    setRules,
    promptTextareaRef,
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
    instructions,
  });
  const [finalOpen, setFinalOpen] = useState(false);
  const [openSections, toggleSection] = useToggledSections();

  const charCount = edited.length;
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
              onRun(edited, Boolean(data?.appendsInternal))
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
