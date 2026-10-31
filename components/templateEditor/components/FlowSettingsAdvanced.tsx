"use client";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "../../ui/field";
import { ConditionBuilder } from "../conditionBuilder/conditionBuilderExports";
import { HookCard } from "../HookCard";
import type { FlowSettingsHook } from "../FlowSettings";

/**
 * The "Advanced" drawer section (Phase 6 grouping): the webhook is always
 * available, so this carries the delivery filter, a copyable sample payload
 * and the hook details behind a collapsed trigger.
 */
export function FlowSettingsAdvanced({
  filter,
  templateId,
  readonly,
  hook,
  onFilterChange,
}: {
  /** the trigger's `filter` expression (null = unset → every delivery starts a flow) */
  filter: string | null;
  /** the owning template's id (Phase 5) — the filter's live preview */
  templateId: string;
  readonly: boolean;
  hook: FlowSettingsHook;
  onFilterChange: (raw: string | null) => void;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <button className="group flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px] hover:text-foreground transition-colors" />
        }
      >
        <ChevronRight className="size-3 transition-transform group-data-panel-open:rotate-90" />{" "}
        Advanced — webhook filter &amp; hook details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 pt-2">
          <Field>
            <FieldLabel>Filter — which deliveries start a flow?</FieldLabel>
            <ConditionBuilder
              value={filter}
              templateId={templateId}
              scope="delivery"
              placeholder={"payload.event"}
              disabled={readonly}
              onChange={onFilterChange}
            />
            <FieldDescription>
              The delivery starts a flow only when the filter is truthy —
              empty means every delivery. It sees the delivery body (
              <code className="font-mono">payload.*</code>) and headers. A
              delivery can also pin the repo + harness: build the body from
              the gallery&apos;s Copy-webhook-payload action.
            </FieldDescription>
          </Field>
          {hook && <HookCard hook={hook} />}
          {!hook && (
            <p className="text-[11px] text-muted-foreground m-0">
              The hook endpoint appears once the template is saved or
              duplicated.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
