import "server-only";

import { db } from "../../db/app";
import { Prisma } from "@prisma/client";
import { FlowRow, Task } from "../../db/rows";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { FLOW_KIND } from "../constants/flowKind";
import { FLOW_CHILD_TABLES } from "../constants/flowChildTables";
import { nodeRegistry } from "../nodes/registry";
import { mergeArena } from "./fanout/mergeArena";
import { worktreeManager } from "./worktreeLifecycle";
import type { NodeStore } from "./nodeStore";
import { parseStartContract, validateAgainstContract } from "../nodes/kinds/start/contract";
import { NO_TASK_TYPE, SDLC_TEMPLATE_ID, templateStore } from "../templates/templateStore";
import type { StepChildPayload } from "./fanout/types/stepChildPayload";
import type { SplitChildPayload } from "./split/types/splitChildPayload";
import type { FlowFactoryHost } from "./flowEngineHost";
import type { CreateFlowOptions } from "./types/flowFactory";

/** Flow creation and template-triggered starts. */
export class FlowFactory {
  private static readonly TASK_SELECT = `SELECT id, type, key, summary, description, status,
       issue_type AS "issueType", priority, repo_url AS "repoUrl",
       parent_key AS "parentKey", external_url AS "externalUrl", raw,
       synced_at AS "syncedAt", fields FROM tasks`;
  private static readonly REPO_DELIVERY_KEY = "repo";
  private static readonly EXEC_MODE_DELIVERY_KEY = "execution_mode";
  private static readonly EXEC_MODE_DELIVERY_ALIAS = "harness";
  private static readonly EXEC_MODE_VALUES = ["local", "cloud"] as const;

  constructor(
    private readonly host: FlowFactoryHost,
    private readonly nodeStore: NodeStore,
  ) {}

  /** Delete a flow tree: cancel active nodes, drop worktrees, delete the child tables in FK-safe order. */
  async deleteFlow(id: string): Promise<void> {
    const flow = await db.get<{ id: string }>(`SELECT id FROM flows WHERE id=$1`, id);
    if (!flow) throw new NotFoundError('flow', id);
    const childIds = (await db.all<{ id: string }>(`SELECT id FROM flows WHERE parent_flow_id=$1`, id)).map(r => r.id);
    const ids = [id, ...childIds];
    for (const fid of ids) {
      if (mergeArena.isMerging(fid)) {
        throw new ConflictError('cannot delete a flow while a step merge is in progress');
      }
    }
    for (const fid of ids) {
      const active = await db.all<{ nodeKey: string; status: string }>(
        `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND status IN ('running','waiting')`,
        fid
      );
      for (const n of active) {
        await this.cancelNodeOf(fid, n.nodeKey);
      }
    }
    // durable waits die with the rows: cancelNode moved every running/waiting
    // node out of `waiting` (clearing wait_until), and the child-table delete
    // below removes the node rows entirely
    await Promise.allSettled(ids.map(fid => worktreeManager.removeFlowWorktree(fid, { reason: 'flow deleted' })));
    await db.transaction(async (tx) => {
      for (const fid of ids) {
        for (const table of FLOW_CHILD_TABLES) {
          await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE flow_id=$1`, fid);
        }
      }
      await tx.$executeRawUnsafe(`DELETE FROM flows WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ...ids);
    });
  }

  private cancelNodeOf(flowId: string, nodeKey: string): Promise<void> {
    return this.host.cancelNode(flowId, nodeKey);
  }

  async create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}, tx?: Prisma.TransactionClient): Promise<string> {
    const task = await db.rows.get(Task, `${FlowFactory.TASK_SELECT} WHERE id=$1`, taskId);
    if (!task) throw new NotFoundError("task", taskId);
    const repo = opts.repoId ? await db.repoById(opts.repoId) : undefined;
    if (repo) repoUrl = repo.cloudUrl;
    const executionMode = opts.executionMode === "local" ? "local" : "cloud";
    if (executionMode === "local" && !repo?.localPath) {
      throw new ValidationError(
        "Local mode requires a repo registered on the Settings page with a local path.",
      );
    }
    const templateId = opts.templateId ?? SDLC_TEMPLATE_ID;
    const graph = await templateStore.graph(templateId);
    if (!graph) throw new NotFoundError("flow template", templateId);
    const declaredType = typeof graph.flowTrigger.taskType === "string" ? graph.flowTrigger.taskType : null;
    if (declaredType && task.type !== declaredType) {
      throw new ValidationError(
        `task ${task.key} is a "${task.type}" task but template "${(await templateStore.flowTemplate(templateId))?.name ?? templateId}" ` +
        `declares "${declaredType}" task context — pick a ${declaredType} task or change the template's task type`,
      );
    }

    const id = db.uid("flow_");
    const ts = db.now();
    await db.transaction(async (exec) => {
      await exec.flow.create({
        data: {
          id, taskId, name: name ?? `${task.key} flow`, status: "active",
          repoUrl, repoId: repo?.id ?? null, executionMode,
          templateId: graph.templateId,
          triggerPayload: opts.triggerPayload != null ? (opts.triggerPayload as never) : Prisma.DbNull,
          createdAt: new Date(ts), updatedAt: new Date(ts),
        },
      });
      await this.nodeStore.insertSnapshots(id, graph, { provisionWebhookHooks: true, ts }, exec);
      await templateStore.persistFlowGraphSnapshot(id, graph, exec);
    }, tx);
    if (opts.autoStart) {
      void this.host.start(id);
    } else {
      const entryKey = nodeRegistry.entryKey();
      const entry = entryKey ? graph.nodes.find((n) => n.defKey === entryKey) : undefined;
      if (entry?.trigger.type === "auto") void this.host.start(id);
    }
    return id;
  }

  async createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: StepChildPayload,
    opts: { branch: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const parent = await db.rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, parentFlowId);
    if (!parent) throw new NotFoundError("flow", parentFlowId);
    const graph = await templateStore.graph(templateId);
    if (!graph) throw new NotFoundError("flow template", templateId);
    const startSpec = graph.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (contractFields.length) {
      const v = validateAgainstContract(contractFields, payload);
      if (!v.ok) {
        throw new Error(
          `payload doesn't match the step child's start contract (template "${(await templateStore.flowTemplate(templateId))?.name ?? templateId}") — ${v.error}`);
      }
    }
    const templateName = (await templateStore.flowTemplate(templateId))?.name ?? templateId;
    const id = db.uid("flow_");
    const ts = db.now();
    await db.transaction(async (exec) => {
      await exec.flow.create({
        data: {
          id, taskId: parent.taskId, name, status: "active",
          repoUrl: parent.repoUrl, repoId: parent.repoId, executionMode: parent.executionMode ?? undefined,
          templateId: graph.templateId,
          triggerPayload: payload as never,
          mrBranch: opts.branch,
          parentFlowId,
          kind: FLOW_KIND.STEP,
          createdAt: new Date(ts), updatedAt: new Date(ts),
        },
      });
      await this.nodeStore.insertSnapshots(id, graph, { ts }, exec);
      await templateStore.persistFlowGraphSnapshot(id, graph, exec);
      await db.emitEvent(id, null, "lifecycle",
        `step child created from "${templateName}" — parent flow ${parentFlowId}`, undefined, exec);
    }, tx);
    return id;
  }

  async createSplitChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SplitChildPayload,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const parent = await db.rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, parentFlowId);
    if (!parent) throw new NotFoundError("flow", parentFlowId);
    const graph = await templateStore.graph(templateId);
    if (!graph) throw new NotFoundError("flow template", templateId);
    const templateName = (await templateStore.flowTemplate(templateId))?.name ?? templateId;
    const id = db.uid("flow_");
    const ts = db.now();
    await db.transaction(async (exec) => {
      await exec.flow.create({
        data: {
          id, taskId: parent.taskId, name, status: "active",
          repoUrl: parent.repoUrl, repoId: parent.repoId, executionMode: parent.executionMode ?? undefined,
          templateId: graph.templateId,
          triggerPayload: payload as never,
          parentFlowId,
          kind: FLOW_KIND.SPLIT,
          createdAt: new Date(ts), updatedAt: new Date(ts),
        },
      });
      await this.nodeStore.insertSnapshots(id, graph, { ts }, exec);
      await templateStore.persistFlowGraphSnapshot(id, graph, exec);
      await db.emitEvent(id, null, "lifecycle",
        `split child created from "${templateName}" — parent flow ${parentFlowId}`, undefined, exec);
    }, tx);
    return id;
  }

  async startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): Promise<string> {
    const t = await templateStore.flowTemplate(templateId);
    if (!t) throw new NotFoundError("template", templateId);
    const trigger = (await templateStore.graph(templateId))?.flowTrigger ?? {};
    const taskType = typeof trigger.taskType === "string" ? trigger.taskType : NO_TASK_TYPE;
    const body = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>) : {};
    const deliveryRepoRaw: unknown = body[FlowFactory.REPO_DELIVERY_KEY];
    const deliveryRepo = typeof deliveryRepoRaw === "string" ? deliveryRepoRaw.trim() : "";
    const rawMode =
      typeof body[FlowFactory.EXEC_MODE_DELIVERY_KEY] === "string"
        ? (body[FlowFactory.EXEC_MODE_DELIVERY_KEY] as string).trim().toLowerCase()
        : typeof body[FlowFactory.EXEC_MODE_DELIVERY_ALIAS] === "string"
          ? (body[FlowFactory.EXEC_MODE_DELIVERY_ALIAS] as string).trim().toLowerCase()
          : "";
    const deliveryMode = (FlowFactory.EXEC_MODE_VALUES as readonly string[]).includes(rawMode)
      ? (rawMode as "local" | "cloud") : undefined;
    let repoId = typeof trigger.repoId === "string" ? trigger.repoId : "";
    if (deliveryRepo) {
      const deliveryRepoRow = await db.repoById(deliveryRepo)
        ?? await db.repoByCloudUrl(deliveryRepo)
        ?? (await db.listRepos()).find((r) => r.name === deliveryRepo);
      if (!deliveryRepoRow) {
        throw new Error(
          `the delivery's "${FlowFactory.REPO_DELIVERY_KEY}" doesn't match a registered repo — ` +
          `use the repo's id, URL or name`);
      }
      repoId = deliveryRepoRow.id;
    }
    if (!repoId) {
      throw new Error(
        `template "${t.name}" has no repo binding — schedule fires and webhook ` +
        `deliveries auto-create flows, so either bind a repo in the template ` +
        `editor's flow settings or pass "${FlowFactory.REPO_DELIVERY_KEY}" in the payload`);
    }
    let taskId = typeof opts.taskId === "string" ? opts.taskId.trim() : "";
    if (taskId) {
      const existing = await db.prisma.task.findUnique({ where: { id: taskId }, select: { type: true } });
      if (!existing) throw new NotFoundError("task", taskId);
      if (existing.type !== taskType) {
        throw new Error(
          `task is a "${existing.type}" task but template "${t.name}" declares "${taskType}" task context — pick a ${taskType} task or change the template's task type`);
      }
    } else {
      const latest = await db.prisma.task.findFirst({
        where: { type: taskType },
        orderBy: { syncedAt: "desc" },
        select: { id: true },
      });
      if (!latest) {
        throw new Error(
          `template "${t.name}" runs on ${taskType} tasks but none are imported yet — import one on the task import screen first`);
      }
      taskId = latest.id;
    }
    const task = await db.rows.get(Task, `SELECT id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields FROM tasks WHERE id=$1`, taskId);
    if (!task) throw new NotFoundError("task", taskId);
    const repo = await db.repoById(repoId);
    if (!repo) {
      throw new ValidationError(
        "the template's bound repo no longer exists — rebind in the template editor",
      );
    }
    const startSpec = (await templateStore.graph(templateId))?.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (contractFields.length) {
      const contractPayload: Record<string, unknown> = { ...body };
      delete contractPayload[FlowFactory.REPO_DELIVERY_KEY];
      delete contractPayload[FlowFactory.EXEC_MODE_DELIVERY_KEY];
      delete contractPayload[FlowFactory.EXEC_MODE_DELIVERY_ALIAS];
      const v = validateAgainstContract(contractFields, contractPayload);
      if (!v.ok) {
        throw new ValidationError(`payload doesn't match the "${t.name}" start contract — ${v.error}`);
      }
    }
    const id = await this.create(taskId, repo.cloudUrl, `${t.name} · ${new Date().toISOString()}`, {
      repoId,
      executionMode: deliveryMode ?? (repo.localPath ? "local" : "cloud"),
      templateId,
      triggerPayload: payload,
      autoStart: true,
    });
    await db.emitEvent(id, null, "lifecycle", `flow auto-created from the "${t.name}" template by a trigger — ${taskType} task ${task.key}`);
    return id;
  }
}
