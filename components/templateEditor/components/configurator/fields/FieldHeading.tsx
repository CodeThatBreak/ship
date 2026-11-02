"use client";
/**
 * The field label, extracted from ConfigFieldRow.tsx: prompt fields carry an
 * info icon — hovering it shows the reference cheat-sheet (the help text
 * lives in the tooltip, not the page) — so those render as a heading; plain
 * fields render as a real label bound to their control through `htmlFor`.
 */
import { Info } from "lucide-react";
import { FieldLabel, FieldTitle } from '../../../../ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/tooltip';
import { promptEditorKeys } from '../../../configFieldLogic';

export function FieldHeading({
  field,
  htmlFor,
}: {
  field: { key: string; label: string; help?: string };
  htmlFor?: string;
}) {
  if (promptEditorKeys.has(field.key)) {
    return (
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
            {field.help ??
              "Type @ to insert an upstream variable — refs resolve at run time."}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }
  return <FieldLabel htmlFor={htmlFor}>{field.label}</FieldLabel>;
}
