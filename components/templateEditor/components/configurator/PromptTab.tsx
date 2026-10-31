"use client";
/**
 * The node configurator's Prompt tab: every prompt-carrying config field of
 * the node, edited as the full prompt surface (body / rules list / output
 * contract / assembled preview) via PromptSectionField — instead of one
 * textarea buried in the Config tab. Built-ins show the built-in body filled
 * into the prompt input itself, with the engine's locked rules riding inline
 * as non-deletable rows and the output contract from the contract's `prompt`
 * sections; declarative kinds edit their free-standing prompt (no split yet).
 */
import { useEffect } from "react";
import { Spinner } from '../../../ui/spinner';
import type { NodeContract } from '../../types';
import { promptEditorKeys, rulesKeyFor, writeConfig } from './fields/ConfigFieldRow';
import { PromptSectionField, type PromptTemplateSection } from './prompt/PromptSectionField';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback';
import type { EditorNode, EditorNodePatch } from '../../types';
import type { VarGroup } from '../../variables';

/** Typing in the prompt body writes the config this often post-quiet — the
 *  draft change re-keys the node's /api/contracts fetch, so per-keystroke
 *  writes would refetch the contract chaotically (and re-key the linter). */
const PROMPT_WRITE_DEBOUNCE_MS = 500;

export function PromptTab({
  node,
  contract,
  varGroups,
  invalidRefs,
  onChange,
  registerPendingFlush,
}: {
  node: EditorNode;
  contract: NodeContract | null;
  /** the grouped variable vocabulary — the prompt editor's @ popover */
  varGroups: VarGroup[];
  /** live-linted refs → the linter's problem (underlined where typed) */
  invalidRefs?: Record<string, string>;
  onChange: (patch: EditorNodePatch) => void;
  /** structural Save flushes trailing prompt writes before snapshotting */
  registerPendingFlush?: (flush: () => void) => () => void;
}) {
  const { invoke: onBodyChange, flush } = useDebouncedCallback(
    (fieldKey: string, v: unknown, extra?: Record<string, unknown>) =>
      onChange((n) => ({
        config: writeConfig(n.config, fieldKey, v, extra),
      })),
    PROMPT_WRITE_DEBOUNCE_MS,
  );

  useEffect(() => {
    if (!registerPendingFlush) return;
    return registerPendingFlush(flush);
  }, [flush, registerPendingFlush]);

  if (!contract) {
    return (
      <p className="text-muted-foreground text-[13px]">
        <Spinner /> Loading prompt…
      </p>
    );
  }
  const defaults = (contract.config?.defaults ?? {}) as Record<string, unknown>;
  const fields = (contract.config?.fields ?? []).filter((f) => promptEditorKeys.has(f.key));
  if (!fields.length) {
    return <p className="text-muted-foreground text-[13px]">This node has no prompt.</p>;
  }
  const section: PromptTemplateSection | undefined = node.is_builtin
    ? contract.prompt?.[0]
    : undefined;
  const decisionSource = String(node.config?.source ?? defaults.source ?? "");
  const gatedOff = (key: string) =>
    contract.kind === "decision" && key === "question" && decisionSource !== "agent";

  return (
    <div className="grid gap-4">
      {fields.map((f) => {
        const rulesKey = node.is_builtin ? rulesKeyFor(f.key) : undefined;
        if (gatedOff(f.key)) {
          return (
            <p key={f.key} className="text-[12px] text-muted-foreground m-0">
              The decision&apos;s source is &ldquo;{decisionSource || "expression"}&rdquo; — no agent
              prompt to configure. Switch the source to &ldquo;agent&rdquo; in the Config tab.
            </p>
          );
        }
        return (
          <PromptSectionField
            key={`${node.key}:${f.key}`}
            field={f}
            value={node.config?.[f.key]}
            rulesKey={rulesKey}
            rulesValue={rulesKey ? node.config?.[rulesKey] : undefined}
            section={section}
            varGroups={varGroups}
            invalidRefs={invalidRefs}
            onBodyChange={(v, extra) => onBodyChange(f.key, v, extra)}
            onRulesChange={(v) =>
              onChange((n) => ({
                config: writeConfig(n.config, rulesKey ?? "", v),
              }))
            }
          />
        );
      })}
    </div>
  );
}
