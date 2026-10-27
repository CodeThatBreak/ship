import { RotateCcw, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The footer row (char count · override badge · show/reset actions) plus the
 * collapsible "Final prompt" preview — exactly what the agent receives. The
 * preview itself only exists for template-owned prompts (an override has no
 * assembled final text, so the toggle renders nothing).
 */
export function FinalPromptFooter({
  charCount,
  isOverride,
  showFinal,
  finalOpen,
  onToggleFinal,
  canReset,
  onReset,
  final,
}: {
  charCount: number;
  isOverride: boolean;
  /** whether the final preview block can be shown (template-owned prompts) */
  showFinal: boolean;
  finalOpen: boolean;
  onToggleFinal: () => void;
  /** the body already matches the template's prompt — reset is disabled */
  canReset: boolean;
  onReset: () => void;
  final?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <span>{charCount.toLocaleString()} chars</span>
        {isOverride && <Badge className="bg-warning/10 text-warning">custom override</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onToggleFinal}>
          <ScrollText size={12} /> {finalOpen ? "Hide final prompt" : "Show final prompt"}
        </Button>
        <Button size="sm" onClick={onReset} disabled={canReset}>
          <RotateCcw size={12} /> Reset to template
        </Button>
      </div>
      {showFinal && finalOpen && (
        <div className="grid gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Final prompt</span>
            <span className="text-[11px] text-muted-foreground">
              {(final?.length ?? 0).toLocaleString()} chars — what the agent receives; live data (context, diffs, logs) finalizes at run time
            </span>
          </div>
          <pre className="text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap m-0 max-h-72 overflow-y-auto">
            {final || "(empty)"}
          </pre>
        </div>
      )}
    </>
  );
}
