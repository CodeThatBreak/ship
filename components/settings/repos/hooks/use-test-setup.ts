"use client";
import { useMutation } from "@tanstack/react-query";
import { FAILED_ACTION } from "@/constants/api";
import { readError } from "../../queries";
import type { RepoFormState, SetupTestResult } from "../types";

/** The policy fields the dry-run resolves against (identity fields are ignored). */
type TestPayload = Pick<
  RepoFormState,
  "local_path" | "install_command" | "skip_install" | "setup_command" | "sync_paths" | "shared_dirs"
>;

async function testSetup(form: TestPayload): Promise<SetupTestResult> {
  const res = await fetch("/api/repos/test-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.TEST);
  return (await res.json()) as SetupTestResult;
}

/**
 * Dry-run the form's current worktree setup policy against the local checkout
 * (POST /api/repos/test-setup). Read-only — no worktree is created and nothing
 * is copied, symlinked or executed; the result is advisory checks.
 */
export function useTestSetup() {
  return useMutation({ mutationFn: testSetup });
}
