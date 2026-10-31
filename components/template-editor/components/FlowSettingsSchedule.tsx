"use client";
import { useState } from "react";
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

const NO_REPO_BOUND_LABEL = "no repo bound";
const NO_REPOS_LABEL = "no repos imported yet";

export const FlowSettingsSchedule = ({
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
  scheduled: boolean;
  intervalMin: number | undefined;
  repos: RepoOption[];
  boundRepo: RepoOption | null;
  readonly: boolean;
  reposPending?: boolean;
  reposError?: string | null;
  onRetryRepos?: () => void;
  onToggleScheduled: () => void;
  onIntervalChange: (minutes: number | undefined) => void;
  onRepoChange: (repoId: string) => void;
}) => {
  const [intervalText, setIntervalText] = useState(() =>
    intervalMin != null && intervalMin > 0 ? String(intervalMin) : "",
  );
  const [intervalErr, setIntervalErr] = useState<string | null>(null);

  const commitInterval = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setIntervalErr("Enter a positive number of minutes");
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setIntervalErr("Enter a positive number of minutes");
      return;
    }
    setIntervalErr(null);
    onIntervalChange(n);
  };

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
              value={intervalText}
              disabled={readonly}
              aria-label="Interval (minutes)"
              aria-invalid={intervalErr != null}
              onChange={(e) => {
                setIntervalText(e.target.value);
                if (intervalErr) setIntervalErr(null);
              }}
              onBlur={() => commitInterval(intervalText)}
            />
            {intervalErr && (
              <FieldDescription className="text-destructive">
                {intervalErr}
              </FieldDescription>
            )}
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
                  <SelectValue>
                    {boundRepo
                      ? `${boundRepo.name}${boundRepo.local_path ? " (local)" : ""}`
                      : NO_REPO_BOUND_LABEL}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
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
};
