"use client";
import { useMutation } from "@tanstack/react-query";
import { FAILED_ACTION } from "@/constants/api";
import { apiFetch } from "@/hooks/localApiToken";
import { readError } from "../../queries";
import type { RepoFormState, SetupTestResult } from "../types";

/** The form fields the probe uses (identity fields beyond these are ignored). */
type TestPayload = Pick<
  RepoFormState,
  | "local_path"
  | "default_branch"
  | "install_command"
  | "skip_install"
  | "setup_command"
  | "sync_paths"
  | "shared_dirs"
  | "worktree_timeout_s"
>;

/** One streamed probe line (NDJSON): a progress event or the final result. */
type ProbeLine =
  | { type: "event"; message: string }
  | { type: "result"; result: SetupTestResult };

/** Line protocol: one JSON object per line, whitespace/newline tolerant. */
function parseProbeLine(line: string): ProbeLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as ProbeLine;
    if ((parsed.type === "event" && typeof parsed.message === "string")
      || (parsed.type === "result" && typeof parsed.result === "object")) {
      return parsed;
    }
    return null;
  } catch {
    return null; // a malformed line is skipped, never fatal
  }
}

/**
 * POST /api/repos/test-setup and read the streamed NDJSON response: every
 * setup step arrives as `{"type":"event"}` and is forwarded to `onStep` as it
 * happens; the final `{"type":"result"}` resolves the mutation.
 */
async function testSetup(form: TestPayload, onStep: (message: string) => void): Promise<SetupTestResult> {
  const res = await apiFetch("/api/repos/test-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.TEST);
  if (!res.body) throw new Error("the test-setup response carried no stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SetupTestResult | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const parsed = parseProbeLine(line);
      if (parsed?.type === "event") onStep(parsed.message);
      if (parsed?.type === "result") result = parsed.result;
      newline = buffer.indexOf("\n");
    }
  }
  if (!result) throw new Error("the test-setup stream ended without a result");
  return result;
}

/**
 * Probe the form's current worktree setup END-TO-END: a real throwaway
 * worktree is created, the full setup pipeline actually runs in it, and the
 * worktree is removed again. Nothing in the hub is mutated beyond git's
 * worktree bookkeeping; the result proves the setup works. Progress streams
 * to `onStep` — pass the callback inside the mutation variables.
 */
export function useTestSetup() {
  return useMutation({
    mutationFn: (input: { form: TestPayload; onStep: (message: string) => void }) =>
      testSetup(input.form, input.onStep),
  });
}
