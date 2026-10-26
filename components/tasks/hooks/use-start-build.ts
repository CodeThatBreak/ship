"use client";
import { useMutation } from "@tanstack/react-query";
import type { ExecutionMode, LiveTask, RepoSummary } from "@/types/tasks";

type MaterializeBody = { id?: string; error?: string };
type CreateFlowBody = { id?: string; error?: string };

/** Everything the start chain needs, gathered once at submit time. */
export type StartBuildArgs = {
  task: LiveTask;
  repo: RepoSummary;
  executionMode: ExecutionMode;
  templateId: string;
};

/**
 * The build-start chain, as one mutation: materialize the live task into the
 * DB (write-through — only the picked task lands there; the engine needs the
 * row for FK + context hydration while browsing stays live-only), pin the
 * repo URL, then create the flow. Resolves with the new flow id; any step's
 * `error` contract surfaces as a thrown Error for the caller to render.
 */
export function useStartBuild(handleStarted: (flowId: string) => void) {
  return useMutation({
    mutationFn: async (args: StartBuildArgs) => {
      const { task, repo, executionMode, templateId } = args;
      if (executionMode === "local" && !repo.local_path) {
        throw new Error(
          `"${repo.name}" has no local path — set one on the Settings page or run in cloud mode.`,
        );
      }
      const mat = await fetch("/api/tasks/materialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      }).then((r) => r.json() as Promise<MaterializeBody>);
      if (!mat.id) {
        throw new Error(mat.error ?? "Failed to start — task could not be stored.");
      }
      await fetch(`/api/tasks/${mat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.cloud_url }),
      });
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: mat.id,
          repoId: repo.id,
          executionMode,
          templateId,
        }),
      }).then((r) => r.json() as Promise<CreateFlowBody>);
      if (!res.id) throw new Error(res.error ?? "Failed to start the flow.");
      return res.id;
    },
    onSuccess: handleStarted,
  });
}
