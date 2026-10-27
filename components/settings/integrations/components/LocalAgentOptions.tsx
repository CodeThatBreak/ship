"use client";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LOCAL_AGENT, LOCAL_AGENT_LABELS, MS_PER_MINUTE, TOGGLE_STATE,
} from "../constants";
import type { LocalAgentField, LocalAgentOptions } from "../types";

/**
 * Local agent options (moved from the General page) — local-run execution
 * settings embedded inside the connected harness's instance card. Borderless:
 * values, disabled state and callbacks come through props (stable refs from
 * the caller's hook).
 */
export function LocalAgentOptions({
  options, savingField, onToggle,
}: {
  options: LocalAgentOptions;
  savingField: LocalAgentField | null;
  onToggle: (field: LocalAgentField) => void;
}) {
  const { force, sandbox, timeout_ms } = options;
  const pending = savingField !== null;

  // stable per §1.3 — callbacks keep their identity across renders
  const toggleForce = useCallback(() => onToggle(LOCAL_AGENT.FIELD.FORCE), [onToggle]);
  const toggleSandbox = useCallback(() => onToggle(LOCAL_AGENT.FIELD.SANDBOX), [onToggle]);

  return (
    <div className="grid gap-2.5">
      <div>
        <div className="font-medium text-[13.5px] leading-tight">
          {LOCAL_AGENT_LABELS.TITLE}
        </div>
        <p className="text-muted-foreground text-[12px] mt-1">
          {LOCAL_AGENT_LABELS.DESCRIPTION}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          size="sm"
          variant={force ? "default" : "outline"}
          disabled={pending}
          onClick={toggleForce}
        >
          {LOCAL_AGENT_LABELS.FORCE}: {force ? TOGGLE_STATE.ON : TOGGLE_STATE.OFF}
        </Button>
        <Button
          size="sm"
          variant={sandbox ? "default" : "outline"}
          disabled={pending}
          onClick={toggleSandbox}
        >
          {LOCAL_AGENT_LABELS.SANDBOX}: {sandbox ? TOGGLE_STATE.ON : TOGGLE_STATE.OFF}
        </Button>
        <span className="text-[12px] text-muted-foreground ml-1">
          {LOCAL_AGENT_LABELS.TIMEOUT_PREFIX} {Math.round(timeout_ms / MS_PER_MINUTE)}{" "}
          {LOCAL_AGENT_LABELS.TIMEOUT_UNIT}
        </span>
      </div>
      {!force && (
        <p className="text-warning text-[12px]">
          {LOCAL_AGENT_LABELS.FORCE_OFF_WARNING}
        </p>
      )}
    </div>
  );
}

/** Skeleton mirroring <LocalAgentOptions /> — title/subtitle, toggle chips row
 *  + timeout text — so the settings query resolves without layout shift
 *  (AGENTS.md §1.8). Shown while GET /api/settings has no local_agent yet. */
export function LocalAgentOptionsSkeleton() {
  return (
    <div aria-hidden className="grid gap-2.5">
      <div className="grid gap-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Skeleton className="h-8 w-44 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}
