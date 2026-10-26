"use client";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTestSetup } from "../hooks/use-test-setup";
import type { RepoFormState, SetupTestCheck } from "../types";

/** One dry-run check row: ✓/✕ marker + label, detail line beside it. */
function SetupTestCheckRow({ check }: { check: SetupTestCheck }) {
  return (
    <li className="flex items-start gap-1.5">
      {check.ok
        ? <Check size={12} className="mt-[3px] shrink-0 text-emerald-600" />
        : <X size={12} className="mt-[3px] shrink-0 text-destructive" />}
      <div className="min-w-0">
        <span className="text-[12px]">{check.label}</span>
        <span className="text-muted-foreground ml-1.5 font-mono text-[11px] break-all">{check.detail}</span>
      </div>
    </li>
  );
}

/**
 * Dry-run the form's current worktree setup policy against the local checkout
 * ("Test setup" button). Purely advisory — no worktree is created and nothing
 * is copied, symlinked or executed. Disabled until a local path is filled in;
 * shows a spinner while running, the server's error on failure, and the check
 * list afterwards (failing checks stay visible — they are the point).
 */
export function SetupTestPanel({ form }: { form: RepoFormState }) {
  const test = useTestSetup();
  const disabled = !form.local_path.trim();
  return (
    <div className="mt-3.5">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || test.isPending}
          onClick={() => test.mutate(form)}
        >
          {test.isPending ? <Spinner /> : null} Test setup
        </Button>
        <span className="text-muted-foreground text-[11.5px] leading-snug">
          {disabled ? "Fill in a local path first." : "Dry-runs the policy against the checkout — nothing is created."}
        </span>
      </div>
      {test.isError ? (
        <p className="text-destructive mt-2 text-[12px]">{test.error.message}</p>
      ) : null}
      {test.data ? (
        <ul className="mt-2 grid gap-1">
          {test.data.checks.map((c) => (
            <SetupTestCheckRow key={c.label} check={c} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
