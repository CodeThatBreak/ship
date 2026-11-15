import "server-only";

import { db } from "../../db/app";
import { FlowRow, rows } from "../../db/rows";
import { DomainError } from "../../errors";
import { hostOf, type HostComment, type HostWebhookEvent } from "../ports/gitHost";
import { templateStore } from "../templates/templateStore";
import { commentStore } from "./commentStore";
import type { WaitScheduler } from "./waitScheduler";

export type CommentIngestorHost = {
  triggerPipelineGate(flowId: string, pipelineId?: number): void;
};

/** Git-host MR lookup and comment ingestion. */
export class CommentIngestor {
  constructor(
    private readonly host: CommentIngestorHost,
    private readonly waits: WaitScheduler,
  ) {}

  async findFlowByMR(projectId: number, mrIid: number, projectUrl?: string): FlowRow | undefined {
    const branchRow = await rows.get(FlowRow,
      `SELECT f.* FROM branches b JOIN flows f ON f.id = b.flowId
       WHERE b.mrIid=$1 AND f.gitlabProjectId=$2`, mrIid, projectId
    );
    if (branchRow) {
      if (projectUrl) {
        const h = hostOf(projectUrl);
        if (h && hostOf(branchRow.repoUrl ?? "") !== h) {
          // host mismatch — fall through to flows table
        } else {
          return branchRow;
        }
      } else {
        return branchRow;
      }
    }
    const candidates = await rows.all(FlowRow,
      `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", current_node AS "currentNode", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE gitlab_project_id=$1 AND mr_iid=$2`, projectId, mrIid
    );
    if (candidates.length <= 1) return candidates[0];
    const h = projectUrl ? hostOf(projectUrl) : null;
    if (!h) return candidates[0];
    return candidates.find((f) => hostOf(f.repoUrl ?? "") === h) ?? candidates[0];
  }

  ingestComments(flowId: string, incoming: HostComment[], mrIid?: number): number {
    return commentStore.ingest(flowId, incoming, mrIid);
  }
async 
  handleHostEvent(event: HostWebhookEvent): void {
    try {
      if (event.kind === "cr_comment") {
        const f = this.findFlowByMR(event.projectId, event.crNumber, event.projectUrl);
        if (!f) return;
        this.ingestComments(f.id, [event.comment], event.crNumber);
        const mins = Math.round(this.waits.resolveDelayMs(f.id) / 60_000);
        this.waits.bounceCommentWaits(f.id);
        await db.emitEvent(f.id, null, "lifecycle",
          `new MR comment from ${event.comment.author || "a reviewer"} — resolve queued for ` +
          `${this.waits.resolveScheduleLabel(f.id)} ` +
          `(${mins} min quiet, then the pipeline gate)`,
          { nodeKey: templateStore.waitNodeKey(f.id, "comments") ?? undefined });
        return;
      }
      const f = event.crNumber
        ? this.findFlowByMR(event.projectId, event.crNumber, event.projectUrl)
        : undefined;
      if (!f) return;
      const gateKey = templateStore.waitNodeKey(f.id, "pipeline");
      const gateStatus = gateKey
        ? db.get<{ status: string }>(
            async `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`, f.id, gateKey
          )?.status
        : undefined;
      if (gateStatus !== "running") {
        await db.emitEvent(f.id, null, "pipeline", `pipeline ${event.pipeline.status}`,
          { status: event.pipeline.status, id: event.pipeline.id, nodeKey: gateKey ?? undefined });
      }
      if (event.pipeline.status === "failed") {
        this.host.triggerPipelineGate(f.id, event.pipeline.id);
      }
    } catch (e: unknown) {
      if (e instanceof DomainError) {
        console.error("[gitlab-webhook] domain error", e);
      } else {
        console.error("[gitlab-webhook] handler error", e);
      }
    }
  }
}
