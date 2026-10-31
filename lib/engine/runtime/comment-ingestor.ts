import "server-only";

import { db } from "../../db";
import { FlowRow, rows } from "../../db/rows";
import { DomainError } from "../../errors";
import { hostOf, type HostComment, type HostWebhookEvent } from "../ports/git-host";
import { templateStore } from "../templates/template-store";
import { commentStore } from "./comment-store";
import type { WaitScheduler } from "./wait-scheduler";

export type CommentIngestorHost = {
  triggerPipelineGate(flowId: string, pipelineId?: number): void;
};

/** Git-host MR lookup and comment ingestion. */
export class CommentIngestor {
  constructor(
    private readonly host: CommentIngestorHost,
    private readonly waits: WaitScheduler,
  ) {}

  findFlowByMR(projectId: number, mrIid: number, projectUrl?: string): FlowRow | undefined {
    const branchRow = rows.get(FlowRow,
      `SELECT f.* FROM branches b JOIN flows f ON f.id = b.flow_id
       WHERE b.mr_iid=? AND f.gitlab_project_id=?`, mrIid, projectId
    );
    if (branchRow) {
      if (projectUrl) {
        const h = hostOf(projectUrl);
        if (h && hostOf(branchRow.repo_url ?? "") !== h) {
          // host mismatch — fall through to flows table
        } else {
          return branchRow;
        }
      } else {
        return branchRow;
      }
    }
    const candidates = rows.all(FlowRow,
      `SELECT * FROM flows WHERE gitlab_project_id=? AND mr_iid=?`, projectId, mrIid
    );
    if (candidates.length <= 1) return candidates[0];
    const h = projectUrl ? hostOf(projectUrl) : null;
    if (!h) return candidates[0];
    return candidates.find((f) => hostOf(f.repo_url ?? "") === h) ?? candidates[0];
  }

  ingestComments(flowId: string, incoming: HostComment[], mrIid?: number): number {
    return commentStore.ingest(flowId, incoming, mrIid);
  }

  handleHostEvent(event: HostWebhookEvent): void {
    try {
      if (event.kind === "cr_comment") {
        const f = this.findFlowByMR(event.projectId, event.crNumber, event.projectUrl);
        if (!f) return;
        this.ingestComments(f.id, [event.comment], event.crNumber);
        const mins = Math.round(this.waits.resolveDelayMs(f.id) / 60_000);
        this.waits.bounceCommentWaits(f.id);
        db.emitEvent(f.id, null, "lifecycle",
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
            `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, f.id, gateKey
          )?.status
        : undefined;
      if (gateStatus !== "running") {
        db.emitEvent(f.id, null, "pipeline", `pipeline ${event.pipeline.status}`,
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
