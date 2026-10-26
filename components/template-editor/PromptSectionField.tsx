"use client";
/**
 * One prompt config field's full editor — the three-part prompt surface
 * (the Prompt tab in the builder drawer, inline on the Node Templates form):
 *
 *   • Your prompt — the rich PromptEditor ("@" variables, live ref linting)
 *   • Your rules  — a LIST editor (one rule per row); rows join with newlines
 *     into the field's rules knob (`prompt_rules` / `fix_prompt_rules`), which
 *     the runtime assembles after the body, before the locked blocks
 *   • Built-in rules / Output contract — the engine's locked blocks, shown
 *     read-only from the contract's `prompt` sections (built-ins only)
 *   • Assembled preview — the four parts joined, `{{vars}}` intact
 *
 * Values write straight through to the config object (the template instance
 * override in the drawer, the definition on the Node Templates page).
 * Decomposed per AGENTS.md §2.2: the locked reference block and the rules
 * list live in `components/`.
 */
import { useState } from "react";
import { Info, Lock } from "lucide-react";
import { FieldTitle } from "../ui/field";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { PromptEditor } from "./PromptEditor";
import { LockedBlock } from "./components/LockedBlock";
import { RulesListEditor } from "./components/RulesListEditor";
import type { VarGroup } from "./variables";

/** One contract `prompt` section (built-ins only — unrendered template parts). */
export interface PromptTemplateSection {
  key: string;
  label: string;
  description: string;
  variables: string[];
  body: string;
  engineRules: string;
  outputContract: string;
}

/** The rules list editor moved to `components/rules-list-editor.tsx` —
 *  re-exported for the consumers that imported it from here. */
export { RulesListEditor } from "./components/RulesListEditor";

/** A local Set-toggle idiom for the collapsible sections (AGENTS.md §2.6:
 *  derived during render, no effect-synced state). */
function useOpenSections(): [Set<string>, (id: string) => void] {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [openSections, toggle];
}

export function PromptSectionField({
  field,
  value,
  rulesKey,
  rulesValue,
  section,
  varGroups,
  invalidRefs,
  onBodyChange,
  onRulesChange,
}: {
  /** the prompt config field (prompt_body / fix_prompt_body / prompt / question) */
  field: { key: string; label: string; help?: string };
  /** the config value of the field (undefined = the built-in default runs) */
  value: unknown;
  /** the config key the rules list writes (undefined = no rules knob) */
  rulesKey?: string;
  /** the config value of the rules knob */
  rulesValue?: unknown;
  /** the template's unrendered parts (built-ins; absent for free prompts) */
  section?: PromptTemplateSection;
  varGroups?: VarGroup[];
  invalidRefs?: Record<string, string>;
  /** writes the body value (plus companions) into the config */
  onBodyChange: (v: unknown, extra?: Record<string, unknown>) => void;
  /** writes the rules knob (undefined = cleared) */
  onRulesChange: (v: unknown) => void;
}) {
  const [openSections, toggle] = useOpenSections();

  const bodyText = typeof value === "string" ? value : "";
  const hasOverride = bodyText.trim().length > 0;
  const rulesText = typeof rulesValue === "string" ? rulesValue : "";
  const hasRules = Boolean(rulesKey);
  // assembled preview: the override (or the built-in body) + rules + locked blocks
  const preview = [
    hasOverride ? bodyText : section?.body ?? "",
    rulesText,
    section?.engineRules,
    section?.outputContract,
  ]
    .filter((s) => typeof s === "string" && s.trim())
    .join("\n\n");

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-1.5">
        <FieldTitle>{field.label}</FieldTitle>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
                <Info size={12} />
              </span>
            }
          />
          <TooltipContent className="max-w-[300px] whitespace-normal text-left leading-relaxed">
            {field.help ?? "Type @ to insert an upstream variable — refs resolve at run time."}
          </TooltipContent>
        </Tooltip>
        {section && <Badge variant="outline" className="text-[10px]">{section.label}</Badge>}
      </div>

      {/* ── part 1: your prompt ─────────────────────────────────────────────── */}
      <PromptEditor
        value={bodyText}
        groups={varGroups ?? []}
        invalidRefs={invalidRefs}
        onChange={(text) => onBodyChange(text || undefined)}
      />
      {!hasOverride && section?.body && (
        <p className="text-[11px] text-muted-foreground m-0">
          No override yet — the built-in body runs (shown under &ldquo;Built-in body&rdquo; below).
        </p>
      )}
      {section?.body && (
        <LockedBlock
          title="Built-in body"
          open={openSections.has("default-body")}
          onToggle={() => toggle("default-body")}
          text={section.body}
          muted
        />
      )}

      {/* ── part 2: your rules (list) ───────────────────────────────────────── */}
      {hasRules && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <FieldTitle>Your rules</FieldTitle>
            <span className="text-[11px] text-muted-foreground">
              one rule per row — appended after the prompt, before the engine&apos;s locked blocks, on every run
            </span>
          </div>
          <RulesListEditor value={rulesValue} onChange={onRulesChange} />
        </div>
      )}

      {/* ── part 3: the engine's locked blocks ──────────────────────────────── */}
      {section?.engineRules && (
        <LockedBlock
          title="Built-in rules"
          badge={<><Lock size={10} /> locked</>}
          open={openSections.has("engine-rules")}
          onToggle={() => toggle("engine-rules")}
          text={section.engineRules}
        />
      )}
      {section?.outputContract && (
        <LockedBlock
          title="Output contract"
          badge={<><Lock size={10} /> locked</>}
          open={openSections.has("contract")}
          onToggle={() => toggle("contract")}
          text={section.outputContract}
          note="The engine re-appends this at run time — the code parses this exact format, so it can&apos;t be edited."
        />
      )}

      {/* ── assembled preview ───────────────────────────────────────────────── */}
      {preview.trim() && (
        <LockedBlock
          title="Assembled preview"
          badge="what the agent receives"
          open={openSections.has("preview")}
          onToggle={() => toggle("preview")}
          text={preview}
          note="Live run data (context, diffs, logs) fills in at run time."
        />
      )}
    </div>
  );
}
