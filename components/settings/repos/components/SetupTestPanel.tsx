"use client";
import { useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTestSetup } from "../hooks/useTestSetup";
import type { RepoFormState } from "../types";

/**
 * Probe the form's current worktree setup END-TO-END ("Test setup" button):
 * a real throwaway worktree is created, the full setup pipeline (config sync,
 * warm caches, dep strategy, setup command) actually runs in it, and the
 * worktree is removed again. This can take minutes on the first run (deps are
 * really installed) — every step streams in live below the button as it
 * happens, timestamped from the probe's start. Disabled until a local path is
 * filled in; a failing probe keeps the step list visible — it is the evidence.
 */
export function SetupTestPanel({ form }: { form: RepoFormState }) {
  const { isPending, isError, error, data, mutate } = useTestSetup();
  // live progress: each streamed step line, stamped from the probe's start
  const [steps, setSteps] = useState<string[]>([]);
  const startedAt = useRef(0);

  const start = () => {
    startedAt.current = Date.now();
    setSteps([]);
    mutate({
      form,
      onStep: (message) => {
        const elapsed = ((Date.now() - startedAt.current) / 1000).toFixed(1);
        setSteps((prev) => [...prev, `[${elapsed}s] ${message}`]);
      },
    });
  };

  const disabled = !form.local_path.trim();
  const seconds = data ? (data.durationMs / 1000).toFixed(1) : null;
  return (
    <div className="mt-3.5">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled || isPending} onClick={start}>
          {isPending ? <Spinner /> : null} Test setup
        </Button>
        <span className="text-muted-foreground text-[11.5px] leading-snug">
          {disabled
            ? "Fill in a local path first."
            : "Runs the real setup in a throwaway worktree, then deletes it — can take minutes."}
        </span>
      </div>
      {isError ? (
        <p className="text-destructive mt-2 text-[12px]">{error.message}</p>
      ) : null}
      {data ? (
        <div className="mt-2 flex items-start gap-1.5">
          {data.ok
            ? <Check size={12} className="mt-[3px] shrink-0 text-emerald-600" />
            : <X size={12} className="mt-[3px] shrink-0 text-destructive" />}
          <div className="min-w-0">
            <span className="text-[12px]">
              {data.ok ? `Setup verified (${seconds}s) — throwaway worktree removed` : "Setup failed"}
            </span>
            {data.error ? (
              <span className="text-destructive ml-1.5 font-mono text-[11px] break-all">{data.error}</span>
            ) : null}
            {data.cleanup ? (
              <p className="text-muted-foreground mt-0.5 text-[11px]">{data.cleanup}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {steps.length ? (
        <ul className="mt-1.5 ml-[18px] grid gap-0.5 font-mono text-[11px] break-all">
          {steps.map((step, i) => (
            <li
              key={i}
              className={
                isPending && i === steps.length - 1 ? "text-foreground" : "text-muted-foreground"
              }
            >
              {step}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
