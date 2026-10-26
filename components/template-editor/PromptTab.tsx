"use client";
/**
 * The node configurator's Prompt tab: every prompt-carrying config field of
 * the node, edited as the full three-part surface (body / rules list / locked
 * built-in blocks / assembled preview) via PromptSectionField — instead of
 * one textarea buried in the Config tab. Built-ins get the template's locked
 * rules + output contract from the contract's `prompt` sections; declarative
 * kinds edit their free-standing prompt (no split yet).
 */
import { Spinner } from "../ui/spinner";
import type { NodeContract } from "./types";
import { promptEditorKeys, rulesKeyFor, writeConfig } from "./ConfigFieldRow";
import { PromptSectionField, type PromptTemplateSection } from "./PromptSectionField";
import type { EditorNode } from "./types";
import type { VarGroup } from "./variables";

export function PromptTab({
  node,
  contract,
  varGroups,
  invalidRefs,
  onChange,
}: {
  node: EditorNode;
  contract: NodeContract | null;
  /** the grouped variable vocabulary — the prompt editor's @ popover */
  varGroups: VarGroup[];
  /** live-linted refs → the linter's problem (underlined where typed) */
  invalidRefs?: Record<string, string>;
  onChange: (p: Partial<EditorNode>) => void;
}) {
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
  // built-ins carry one prompt template per prompt field today — the contract
  // lists the def's promptSections in order
  const section: PromptTemplateSection | undefined = node.is_builtin
    ? contract.prompt?.[0]
    : undefined;
  // the decision's prompt only applies to the agent source (mirrors the
  // Config tab's field gating)
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
            onBodyChange={(v, extra) => onChange({ config: writeConfig(node.config, f.key, v, extra) })}
            onRulesChange={(v) => onChange({ config: writeConfig(node.config, rulesKey ?? "", v) })}
          />
        );
      })}
    </div>
  );
}
