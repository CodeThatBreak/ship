import "server-only";

/**
 * The flow columns the reconciler reads (select shape for Prisma queries;
 * result rows are cast to FlowRow — the aliases match its fields).
 */
export const FLOW_SELECT = {
  id: true, taskId: true, name: true, status: true, mrUrl: true, mrIid: true,
  mrBranch: true, repoUrl: true, gitlabProjectId: true,
  executionMode: true, repoId: true, templateId: true, templateGraph: true,
  triggerPayload: true, worktreeDir: true, kind: true,
  createdAt: true, updatedAt: true,
} as const;
