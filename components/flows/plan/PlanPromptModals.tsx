"use client";
import { PromptModal, type PromptRunExtras } from "@/components/chat";
import { PLAN_NODE_KEY } from "./constants";

/**
 * The plan panel's two prompt modals: the whole-plan edit/start prompt, and
 * the branch-scoped sub-plan refine prompt (§7.1) with the context picker.
 * Scoped refines default to a fresh agent (§3).
 */
export function PlanPromptModals({
  flowId,
  showPrompt,
  refineBranch,
  hasAgent,
  onRunPrompt,
  onRunBranchRefine,
  onClosePrompt,
  onCloseRefine,
}: {
  flowId: string;
  showPrompt: boolean;
  /** the branch being refined; null hides the scoped-refine modal */
  refineBranch: string | null;
  hasAgent: boolean;
  onRunPrompt: (prompt: string, promptIsBody: boolean) => void;
  onRunBranchRefine: (
    prompt: string,
    promptIsBody: boolean,
    extras: PromptRunExtras,
  ) => void;
  onClosePrompt: () => void;
  onCloseRefine: () => void;
}) {
  return (
    <>
      {showPrompt && (
        <PromptModal
          flowId={flowId}
          nodeKey={PLAN_NODE_KEY}
          open={showPrompt}
          onClose={onClosePrompt}
          onRun={(prompt, promptIsBody) => {
            onRunPrompt(prompt, promptIsBody);
            onClosePrompt();
          }}
        />
      )}

      {refineBranch && (
        <PromptModal
          flowId={flowId}
          nodeKey={PLAN_NODE_KEY}
          branch={refineBranch}
          open={Boolean(refineBranch)}
          onClose={onCloseRefine}
          onRun={(prompt, promptIsBody, extras) => {
            onRunBranchRefine(prompt, promptIsBody, extras);
            onCloseRefine();
          }}
          showContextPicker
          defaultFresh
          hasAgent={hasAgent}
        />
      )}
    </>
  );
}
