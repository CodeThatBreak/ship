import "server-only";

import { db } from "../../db/app";
import { FlowRow } from "../../db/rows";
import { DomainError } from "../../errors";
import { hostOf, type HostComment, type HostWebhookEvent } from "../ports/gitHost";
import { templateStore } from "../templates/templateStore";
import { commentStore } from "./commentStore";
import { TRIGGER_SOURCE } from "./triggers/constants/triggerSources";
import type { WaitStore } from "./waits/waitStore";
import type { TriggerResult, TriggerSource } from "./triggers/types/triggerGateway";

export type CommentIngestorHost = {
  triggerPipelineGate(flowId: string, pipelineId?: number, model?: string, source?: TriggerSource): Promise<TriggerResult>;
};

/** Git-host MR lookup and comment ingestion. */
export class CommentIngestor {
  constructor(
    private readonly host: CommentIngestorHost,
    private readonly waits: WaitStore,
  ) {}

  async findFlowByMR(projectId: number, mrIid: number, projectUrl?: string): Promise<FlowRow | undefined> {
    const branchRow = await db.prisma.branch.findFirst({
      where: { mrIid, flow: { gitlabProjectId: projectId } },
      select: {
        flow: {
          select: {
            id: true, taskId: true, name: true, status: true, mrUrl: true, mrIid: true,
            mrBranch: true, repoUrl: true, gitlabProjectId: true,
            executionMode: true, repoId: true, templateId: true, templateGraph: true,
            triggerPayload: true, worktreeDir: true, parentFlowId: true, kind: true,
            createdAt: true, updatedAt: true,
          },
        },
      },
    });
    if (branchRow?.flow) {
      if (projectUrl) {
        const h = hostOf(projectUrl);
        if (h && hostOf(branchRow.flow.repoUrl ?? "") !== h) {
          // host mismatch — fall through to flows table
        } else {
          return branchRow.flow as unknown as FlowRow;
        }
      } else {
        return branchRow.flow as unknown as FlowRow;
      }
    }
    const candidates = await db.prisma.flow.findMany({
      where: { gitlabProjectId: projectId, mrIid },
      select: {
        id: true, taskId: true, name: true, status: true, mrUrl: true, mrIid: true,
        mrBranch: true, repoUrl: true, gitlabProjectId: true,
        executionMode: true, repoId: true, templateId: true, templateGraph: true,
        triggerPayload: true, worktreeDir: true, parentFlowId: true, kind: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (candidates.length <= 1) return candidates[0] as unknown as FlowRow | undefined;
    const h = projectUrl ? hostOf(projectUrl) : null;
    if (!h) return candidates[0] as unknown as FlowRow | undefined;
    return (candidates.find((f) => hostOf(f.repoUrl ?? "") === h) ?? candidates[0]) as unknown as FlowRow | undefined;
  }

  async ingestComments(flowId: string, incoming: HostComment[], mrIid?: number): Promise<number> {
    return commentStore.ingest(flowId, incoming, mrIid);
  }

  async handleHostEvent(event: HostWebhookEvent): Promise<void> {
    try {
      if (event.kind === "cr_comment") {
        const f = await this.findFlowByMR(event.projectId, event.crNumber, event.projectUrl);
        if (!f) return;
        await this.ingestComments(f.id, [event.comment], event.crNumber);
        const mins = Math.round((await this.waits.resolveDelayMs(f.id)) / 60_000);
        await this.waits.bounceCommentWaits(f.id);
        await db.emitEvent(f.id, null, "lifecycle",
          `new MR comment from ${event.comment.author || "a reviewer"} — resolve queued for ` +
          `${await this.waits.resolveScheduleLabel(f.id)} ` +
          `(${mins} min quiet, then the pipeline gate)`,
          { nodeKey: (await templateStore.waitNodeKey(f.id, "comments")) ?? undefined });
        return;
      }
      const f = event.crNumber
        ? await this.findFlowByMR(event.projectId, event.crNumber, event.projectUrl)
        : undefined;
      if (!f) return;
      const gateKey = await templateStore.waitNodeKey(f.id, "pipeline");
      const gateStatus = gateKey
        ? (await db.prisma.node.findFirst({
            where: { flowId: f.id, nodeKey: gateKey },
            select: { status: true },
          }))?.status
        : undefined;
      if (gateStatus !== "running") {
        await db.emitEvent(f.id, null, "pipeline", `pipeline ${event.pipeline.status}`,
          { status: event.pipeline.status, id: event.pipeline.id, nodeKey: gateKey ?? undefined });
      }
      if (event.pipeline.status === "failed") {
        await this.host.triggerPipelineGate(f.id, event.pipeline.id, undefined, TRIGGER_SOURCE.WEBHOOK);
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
