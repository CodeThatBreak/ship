import { Lock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { LockedSection } from "./LockedSection";

/**
 * Part 2 — the rules block: the engine's built-in rules (locked) above an
 * editable "your rules" box that persists through the container's save
 * action. Save/error state is rendered verbatim from what the container
 * derived (dirty / saved / error) so the layout stays in one place.
 */
export function RulesSection({
  open,
  onToggle,
  engineRules,
  rules,
  onRulesChange,
  onSaveRules,
  savingRules,
  rulesSaved,
  rulesError,
  rulesDirty,
}: {
  open: boolean;
  onToggle: () => void;
  /** the engine-authored rules (built-in, not editable here) */
  engineRules?: string;
  rules: string;
  onRulesChange: (value: string) => void;
  onSaveRules: () => void;
  savingRules: boolean;
  rulesSaved: boolean;
  rulesError?: string | null;
  rulesDirty: boolean;
}) {
  return (
    <LockedSection
      title="Rules"
      badge={<>built-in <Lock size={10} /> + yours</>}
      open={open}
      onToggle={onToggle}
      lockedText={engineRules}
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
          onChange={(e) => onRulesChange(e.target.value)}
          placeholder="e.g. always ask before assuming a framework; prefer the smallest diff that fixes the issue"
          className="w-full bg-background border-border rounded-lg px-3 py-2 text-[12px] font-mono leading-relaxed resize-y min-h-[60px]"
          rows={3}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onSaveRules} disabled={savingRules || !rulesDirty}>
            {savingRules ? <Spinner /> : <Save size={12} />} Save rules
          </Button>
          {rulesSaved && <span className="text-[11px] text-success">saved — applies to every run</span>}
          {rulesError && (
            <span className="text-[11px] text-destructive">
              {rulesError} — fix the problem and save again
            </span>
          )}
          {rulesDirty && !rulesError && (
            <span className="text-[11px] text-muted-foreground">
              unsaved — run uses the saved rules{rules.trim() === "" ? " (none)" : ""}
            </span>
          )}
        </div>
      </div>
    </LockedSection>
  );
}
