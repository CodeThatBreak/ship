"use client";
import { RefreshCw } from "lucide-react";
import { Field, FieldDescription, FieldLabel } from "../../ui/field";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { Switch } from "../../ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import type { RepoOption } from "../FlowSettings";

/** The unbound picker's label (only registered repos list below it). */
const NO_REPO_BOUND_LABEL = "no repo bound";
/** The picker's empty state (nothing registered, so there is no valid option). */
const NO_REPOS_LABEL = "no repos imported yet";

/**
 * The "When flows start" section (Phase 6 grouping): manual starts and webhook
 * deliveries are built-in levers for every flow, so the declared trigger only
 * toggles the optional Schedule (interval + bound repo).
 */
export function FlowSettingsSchedule({
  scheduled,
  intervalMin,
  repos,
  boundRepo,
  readonly,
  reposPending = false,
  reposError = null,
  onRetryRepos,
  onToggleScheduled,
  onIntervalChange,
  onRepoChange,
}: {
  /** the declared trigger carries `type: "schedule"` */
  scheduled: boolean;
  /** the trigger's `interval_min` when set (the input's value) */
  intervalMin: number;
  repos: RepoOption[];
  /** the repo currently bound to the trigger */
  boundRepo: RepoOption | null;
  readonly: boolean;
  reposPending?: boolean;
  reposError?: string | null;
  onRetryRepos?: () => void;
  onToggleScheduled: () => void;
  onIntervalChange: (minutes: number | undefined) => void;
  onRepoChange: (repoId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
        When flows start
      </div>
      <p className="text-[12px] text-muted-foreground m-0">
        Every flow can be started manually from the home page&apos;s task
        picker or by a delivery to this template&apos;s webhook — no switch
        needed. Below: auto-create flows on an interval (optional).
      </p>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="flow-schedule">Schedule</FieldLabel>
          <Switch
            id="flow-schedule"
            size="sm"
            disabled={readonly}
            checked={scheduled}
            onCheckedChange={onToggleScheduled}
          />
        </div>
        <FieldDescription>
          {scheduled
            ? "Each fire auto-creates one flow from the repo binding below, attaching the most recent imported task."
            : "Off — flows only start when you trigger them."}
        </FieldDescription>
      </Field>
      {scheduled && (
        <>
          <Field>
            <FieldLabel htmlFor="flow-interval">Interval (minutes)</FieldLabel>
            <Input
              id="flow-interval"
              type="number"
              min={1}
              value={intervalMin}
              disabled={readonly}
              aria-label="Interval (minutes)"
              onChange={(e) =>
                onIntervalChange(
                  Number(e.target.value) > 0 ? Number(e.target.value) : undefined,
                )
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="flow-bound-repo">Bound repo</FieldLabel>
            {reposPending ? (
              <Skeleton className="h-9 w-full rounded-lg" />
            ) : reposError ? (
              <p className="text-[12px] text-destructive m-0 flex items-center gap-2">
                {reposError}
                {onRetryRepos && (
                  <Button variant="outline" size="xs" onClick={() => void onRetryRepos()}>
                    <RefreshCw size={12} /> Retry
                  </Button>
                )}
              </p>
            ) : repos.length === 0 ? (
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
                onValueChange={(repoId) => onRepoChange(repoId ?? "")}
              >
                <SelectTrigger
                  id="flow-bound-repo"
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
            <FieldDescription>
              Fires attach this repo. A webhook delivery can point at another
              registered repo instead — pass <code className="font-mono">repo</code> in its payload.
            </FieldDescription>
          </Field>
        </>
      )}
    </div>
  );
}
