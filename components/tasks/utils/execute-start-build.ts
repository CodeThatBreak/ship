import { patchJson, postJson } from "@/hooks/fetch-json";
import { RUN_MODE } from "@/constants/execution";
import type { ExecutionMode, LiveTask, RepoSummary } from "@/types/tasks";

type MaterializeBody = { id?: string; error?: string };
type CreateFlowBody = { id?: string; error?: string };
type PatchTaskBody = Record<string, never>;

/** Everything the start chain needs, gathered once at submit time. */
export type StartBuildArgs = {
  task: LiveTask;
  repo: RepoSummary;
  executionMode: ExecutionMode;
  templateId: string;
};

/**
 * Materialize the live task, pin the repo URL, then create the flow. Throws on
 * any step failure so callers never proceed after a failed repo pin.
 */
export const executeStartBuild = async (args: StartBuildArgs): Promise<string> => {
  const { task, repo, executionMode, templateId } = args;
  if (executionMode === RUN_MODE.LOCAL && !repo.local_path) {
    throw new Error(
      `"${repo.name}" has no local path — set one on the Settings page or run in cloud mode.`,
    );
  }
  const mat = await postJson<MaterializeBody>(
    "/api/tasks/materialize",
    JSON.stringify({ task }),
  );
  if (!mat.id) {
    throw new Error(mat.error ?? "Failed to start — task could not be stored.");
  }
  await patchJson<PatchTaskBody>(
    `/api/tasks/${mat.id}`,
    JSON.stringify({ repoUrl: repo.cloud_url }),
  );
  const flow = await postJson<CreateFlowBody>(
    "/api/flows",
    JSON.stringify({
      taskId: mat.id,
      repoId: repo.id,
      executionMode,
      templateId,
    }),
  );
  if (!flow.id) throw new Error(flow.error ?? "Failed to start the flow.");
  return flow.id;
};
