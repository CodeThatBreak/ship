import type { RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

/**
 * Part 1 of the prompt (AGENTS.md §2.2): the insertable `{{variables}}` row
 * plus the editable body textarea. Purely presentational — the insert handler
 * (and its cursor restoration) comes from the container.
 */
export function PromptEditorSection({
  variables,
  edited,
  onEditedChange,
  onInsertVariable,
  textareaRef,
  fromTemplateConfig,
}: {
  variables: string[];
  edited: string;
  onEditedChange: (v: string) => void;
  onInsertVariable: (variable: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** the body came from the template's config knob, not the built-in default */
  fromTemplateConfig?: boolean;
}) {
  return (
    <>
      {variables.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[11px] text-muted-foreground uppercase tracking-[0.5px] mr-1">Insert:</span>
          {variables.map((v) => (
            <Badge
              key={v}
              className="cursor-pointer hover:border-info hover:text-info transition-colors"
              onClick={() => onInsertVariable(v)}
            >
              {`{{${v}}}`}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Your prompt</span>
          {fromTemplateConfig && <Badge className="bg-info/10 text-info">from template config</Badge>}
        </div>
        <Textarea
          ref={textareaRef}
          value={edited}
          onChange={(e) => onEditedChange(e.target.value)}
          className="w-full bg-background border-border rounded-lg px-3.5 py-3 text-[12.5px] font-mono leading-relaxed resize-y min-h-[200px]"
          rows={12}
        />
      </div>
    </>
  );
}
