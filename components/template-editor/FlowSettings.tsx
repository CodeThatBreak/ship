/**
 * The flow-settings drawer body (Phase 6 grouping, F2): template meta, the
 * declared task context, then "When flows start" — manual (the task picker)
 * and webhook deliveries are built-in levers for every flow, so the declared
 * trigger only toggles the optional Schedule (interval + bound repo). The
 * webhook block under "Advanced" carries the delivery filter, a copyable
 * sample payload and the hook details (the secret masked, reveal/copy).
 *
 * Decomposed per AGENTS.md §2.2: the meta fields + composition stay here; the
 * schedule and advanced sections live in `components/`.
 */
"use client";
import { Lock } from "lucide-react";
import { Field, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { TaskContextSection } from "./TaskContextSection";
import { FlowSettingsAdvanced } from "./components/FlowSettingsAdvanced";
import { FlowSettingsSchedule } from "./components/FlowSettingsSchedule";
import type { TaskProviderInfo } from "./types";

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
        <Field>
          <FieldLabel htmlFor="flow-template-name">Template name</FieldLabel>
          <Input
            id="flow-template-name"
            value={draft.template.name}
            disabled={readonly}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="flow-template-description">Description</FieldLabel>
          <Textarea
            id="flow-template-description"
            value={draft.template.description ?? ""}
            rows={2}
            disabled={readonly}
            onChange={(e) => onChange({ description: e.target.value || null })}
            className="bg-card text-foreground border-border text-[13px] px-3 py-2 resize-y"
          />
        </Field>
      </div>

      {/* ── Task context (Phase 3): the declared task type + its fields ── */}
      <TaskContextSection
        providers={providers}
        taskType={taskType}
        readonly={readonly}
        onPick={(v) => setTrigger({ task_type: v || undefined })}
      />

      {/* ── When flows start (Phase 6 grouping): built-in levers + schedule ── */}
      <FlowSettingsSchedule
        scheduled={scheduled}
        intervalMin={Number(trigger.interval_min ?? 60)}
        repos={repos}
        boundRepo={boundRepo}
        readonly={readonly}
        onToggleScheduled={scheduledOn}
        onIntervalChange={(interval_min) => setTrigger({ interval_min })}
        onRepoChange={(repo_id) => setTrigger({ repo_id })}
      />

      {/* ── Advanced (webhook is always available): filter + payload + hook ── */}
      <FlowSettingsAdvanced
        filter={typeof trigger.filter === "string" ? trigger.filter : null}
        templateId={templateId}
        readonly={readonly}
        hook={hook}
        onFilterChange={(raw) => setTrigger({ filter: raw || undefined })}
      />
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
