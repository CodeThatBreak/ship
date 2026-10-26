/**
 * The flow-settings drawer body (Phase 6 grouping, F2): template meta, the
 * declared task context, then "When flows start" — manual (the task picker)
 * and webhook deliveries are built-in levers for every flow, so the declared
 * trigger only toggles the optional Schedule (interval + bound repo). The
 * webhook block under "Advanced" carries the delivery filter, a copyable
 * sample payload and the hook details (the secret masked, reveal/copy).
 */
import { ChevronRight, Lock } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ConditionBuilder } from "./ConditionBuilder";
import { HookCard } from "./HookCard";
import { TaskContextSection } from "./TaskContextSection";
import type { TaskProviderInfo } from "./types";

/** The unbound picker's label (only registered repos list below it). */
const NO_REPO_BOUND_LABEL = "no repo bound";
/** The picker's empty state (nothing registered, so there is no valid option). */
const NO_REPOS_LABEL = "no repos imported yet";

/** A registered repo (GET /repos list slice) — the Bound-repo picker's option. */
export type RepoOption = {
  id: string;
  name: string;
  local_path: string | null;
};

/** An inbound hook — the template's always-provisioned webhook endpoint. */
export type FlowSettingsHook = { id: string; secret: string } | null;

/** The slice of the template draft this drawer edits. */
export type FlowSettingsDraft = {
  template: {
    name: string;
    description: string | null;
    /** the flow trigger ({ type, task_type, repo_id, filter, … }) */
    trigger: Record<string, unknown>;
  };
};

export function FlowSettingsBody({
  draft,
  readonly,
  hook,
  providers,
  repos,
  templateId,
  onChange,
}: {
  draft: FlowSettingsDraft;
  readonly: boolean;
  hook: FlowSettingsHook;
  providers: TaskProviderInfo[];
  repos: RepoOption[];
  /** the owning template's id (Phase 5) — the filter's live preview */
  templateId: string;
  onChange: (t: Partial<FlowSettingsDraft["template"]>) => void;
}) {
  const trigger = draft.template.trigger ?? {};
  const setTrigger = (patch: Record<string, unknown>) =>
    onChange({ trigger: { ...trigger, ...patch } });
  /** the declared trigger only carries the schedule — manual starts and
   *  webhook deliveries are always available, no picker for them */
  const scheduled = String(trigger.type ?? "manual") === "schedule";
  const scheduledOn = () => setTrigger({ type: scheduled ? "manual" : "schedule" });
  /** the bound repo row — SelectValue's label is computed from it, and the
   *  copy action's sample payload seeds its reserved `repo` key from it */
  const triggerRepoId =
    typeof trigger.repo_id === "string" ? trigger.repo_id : "";
  const boundRepo = repos.find((r) => r.id === triggerRepoId) ?? null;
  // the declared task type (Phase 3): which task type the template's flows run
  // on. Absent → the first registered provider (matching the store's parse
  // rule); its fields become the {{task.*}} vocabulary the sections below
  // advertise.
  const taskType = String(trigger.task_type ?? providers[0]?.kind ?? "");
  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <div className="grid gap-1">
          <Label>Template name</Label>
          <Input
            value={draft.template.name}
            disabled={readonly}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label>Description</Label>
          <Textarea
            value={draft.template.description ?? ""}
            rows={2}
            disabled={readonly}
            onChange={(e) => onChange({ description: e.target.value || null })}
            className="bg-card text-foreground border-border text-[13px] px-3 py-2 resize-y"
          />
        </div>
      </div>

      {/* ── Task context (Phase 3): the declared task type + its fields ── */}
      <TaskContextSection
        providers={providers}
        taskType={taskType}
        readonly={readonly}
        onPick={(v) => setTrigger({ task_type: v || undefined })}
      />

      {/* ── When flows start (Phase 6 grouping): built-in levers + schedule ── */}
      <div className="grid gap-3">
        <div className="text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
          When flows start
        </div>
        <p className="text-[12px] text-muted-foreground m-0">
          Every flow can be started manually from the home page&apos;s task
          picker or by a delivery to this template&apos;s webhook — no switch
          needed. Below: auto-create flows on an interval (optional).
        </p>
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="flow-schedule">Schedule</Label>
            <Switch
              id="flow-schedule"
              size="sm"
              disabled={readonly}
              checked={scheduled}
              onCheckedChange={scheduledOn}
            />
          </div>
          <p className="text-[11px] text-muted-foreground m-0">
            {scheduled
              ? "Each fire auto-creates one flow from the repo binding below, attaching the most recent imported task."
              : "Off — flows only start when you trigger them."}
          </p>
        </div>
        {scheduled && (
          <>
            <div className="grid gap-1">
              <Label>Interval (minutes)</Label>
              <Input
                type="number"
                min={1}
                value={Number(trigger.interval_min ?? 60)}
                disabled={readonly}
                aria-label="Interval (minutes)"
                onChange={(e) =>
                  setTrigger({
                    interval_min:
                      Number(e.target.value) > 0
                        ? Number(e.target.value)
                        : undefined,
                  })
                }
              />
            </div>
            <div className="grid gap-1">
              <Label>Bound repo</Label>
              {repos.length === 0 ? (
                <div
                  className="flex items-center h-9 rounded-lg border border-dashed border-border bg-muted/30 px-3 text-[12.5px] text-muted-foreground"
                  aria-disabled
                >
                  {NO_REPOS_LABEL}
                </div>
              ) : (
                <Select
                  value={boundRepo?.id ?? ""}
                  disabled={readonly}
                  onValueChange={(v) => setTrigger({ repo_id: v })}
                >
                  <SelectTrigger
                    className="w-full rounded-lg border-border bg-card"
                    aria-label="Bound repo"
                  >
                    {/* SelectValue's children always win over the selected value —
                        the label is computed from the binding; a static
                        placeholder would never show the picked repo */}
                    <SelectValue>
                      {boundRepo
                        ? `${boundRepo.name}${boundRepo.local_path ? " (local)" : ""}`
                        : NO_REPO_BOUND_LABEL}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {/* only valid options — no clearing item; unbinding means
                        switching repo or turning the schedule off */}
                    {repos.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                        {r.local_path ? " (local)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground m-0">
                Fires attach this repo. A webhook delivery can point at another
                registered repo instead — pass <code className="font-mono">repo</code> in its payload.
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Advanced (webhook is always available): filter + payload + hook ── */}
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
            <div className="grid gap-1">
              <Label>Filter — which deliveries start a flow?</Label>
              <ConditionBuilder
                value={
                  typeof trigger.filter === "string" ? trigger.filter : null
                }
                templateId={templateId}
                scope="delivery"
                placeholder={"payload.event"}
                disabled={readonly}
                onChange={(raw) => setTrigger({ filter: raw || undefined })}
              />
              <p className="text-[11px] text-muted-foreground m-0">
                The delivery starts a flow only when the filter is truthy —
                empty means every delivery. It sees the delivery body (
                <code className="font-mono">payload.*</code>) and headers. A
                delivery can also pin the repo + harness: build the body from
                the gallery&apos;s Copy-webhook-payload action.
              </p>
            </div>
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
      {readonly && (
        <p className="text-[11.5px] text-muted-foreground m-0 flex items-start gap-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" />
          Built-in templates are read-only. Use the gallery&apos;s duplicate
          action to make an editable copy.
        </p>
      )}
    </div>
  );
}
