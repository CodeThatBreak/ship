import "server-only";

import { db } from "../../db/app";
import { FlowRow, Task } from "../../db/rows";
import { NotFoundError, ValidationError } from "../../errors";
import { FLOW_KIND } from "../constants/flowKind";
import { nodeRegistry } from "../nodes/registry";
import { nodeStore } from "./nodeStore";
import { parseStartContract, validateAgainstContract } from "../nodes/kinds/start/contract";
import { NO_TASK_TYPE, SDLC_TEMPLATE_ID, templateStore } from "../templates/templateStore";
import type { StepChildPayload } from "./fanout/stepFlowManager";
import type { SplitChildPayload } from "./split/splitManager";
import type { FlowFactoryHost } from "./flowEngineHost";

const FLOW_SELECT = `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl",
       mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl",
       gitlab_project_id AS "gitlabProjectId", current_node AS "currentNode",
       execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId",
       template_graph AS "templateGraph", trigger_payload AS "triggerPayload",
       worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind,
       created_at AS "createdAt", updated_at AS "updatedAt" FROM flows`;
const TASK_SELECT = `SELECT id, type, key, summary, description, status,
       issue_type AS "issueType", priority, repo_url AS "repoUrl",
       parent_key AS "parentKey", external_url AS "externalUrl", raw,
       synced_at AS "syncedAt", fields FROM tasks`;

export interface CreateFlowOptions {
  executionMode?: "cloud" | "local";
  repoId?: string;
  templateId?: string;
  triggerPayload?: unknown;
  autoStart?: boolean;
}

const REPO_DELIVERY_KEY = "repo";
const EXEC_MODE_DELIVERY_KEY = "execution_mode";
const EXEC_MODE_DELIVERY_ALIAS = "harness";
const EXEC_MODE_VALUES = ["local", "cloud"] as const;

/** Flow creation and template-triggered starts. */
export class FlowFactory {
  constructor(private readonly host: FlowFactoryHost) {}

  async create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): Promise<string> {
    const task = await db.rows.get(Task, `${TASK_SELECT} WHERE id=$1`, taskId);
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
    await db.transaction(async (tx) => {
      await tx.flow.create({
        data: {
          id, taskId, name: name ?? `${task.key} flow`, status: "active",
          repoUrl, repoId: repo?.id ?? null, executionMode,
          templateId: graph.templateId,
          triggerPayload: opts.triggerPayload != null ? (opts.triggerPayload as never) : null,
          createdAt: new Date(ts), updatedAt: new Date(ts),
        },
      });
      await nodeStore.insertSnapshots(id, graph, { provisionWebhookHooks: true, ts });
      await templateStore.persistFlowGraphSnapshot(id, graph);
      void tx;
    });
    if (opts.autoStart) {
      this.host.start(id);
    } else {
      const entryKey = nodeRegistry.entryKey();
      const entry = entryKey ? graph.nodes.find((n) => n.defKey === entryKey) : undefined;
      if (entry?.trigger.type === "auto") this.host.start(id);
    }
    return id;
  }

  async createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: StepChildPayload,
    opts: { branch: string | null },
  ): Promise<string> {
    const parent = await db.rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", current_node AS "currentNode", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, parentFlowId);
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
    const id = db.uid("flow_");
    const ts = db.now();
    await db.transaction(async (tx) => {
      await tx.flow.create({
        data: {
          id, taskId: parent.taskId, name, status: "active",
          repoUrl: parent.repoUrl, repoId: parent.repoId, executionMode: parent.executionMode,
          templateId: graph.templateId,
          triggerPayload: payload as never,
          mrBranch: opts.branch,
          parentFlowId,
          kind: FLOW_KIND.STEP,
          createdAt: new Date(ts), updatedAt: new Date(ts),
        },
      });
      await nodeStore.insertSnapshots(id, graph, { ts });
      await templateStore.persistFlowGraphSnapshot(id, graph);
      await db.emitEvent(id, null, "lifecycle",
        `step child created from "${(await templateStore.flowTemplate(templateId))?.name ?? templateId}" — parent flow ${parentFlowId}`);
    });
    return id;
  }

  async createSplitChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SplitChildPayload,
  ): Promise<string> {
    const parent = await db.rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", current_node AS "currentNode", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, parentFlowId);
    if (!parent) throw new NotFoundError("flow", parentFlowId);
    const graph = await templateStore.graph(templateId);
    if (!graph) throw new NotFoundError("flow template", templateId);
    const id = db.uid("flow_");
    const ts = db.now();
    await db.transaction(async (tx) => {
      await tx.flow.create({
        data: {
          id, taskId: parent.taskId, name, status: "active",
          repoUrl: parent.repoUrl, repoId: parent.repoId, executionMode: parent.executionMode,
          templateId: graph.templateId,
          triggerPayload: payload as never,
          parentFlowId,
          kind: FLOW_KIND.SPLIT,
          createdAt: new Date(ts), updatedAt: new Date(ts),
        },
      });
      await nodeStore.insertSnapshots(id, graph, { ts });
      await templateStore.persistFlowGraphSnapshot(id, graph);
      await db.emitEvent(id, null, "lifecycle",
        `split child created from "${(await templateStore.flowTemplate(templateId))?.name ?? templateId}" — parent flow ${parentFlowId}`);
    });
    return id;
  }

  async startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): Promise<string> {
    const t = await templateStore.flowTemplate(templateId);
    if (!t) throw new NotFoundError("template", templateId);
    const trigger = (await templateStore.graph(templateId))?.flowTrigger ?? {};
    const taskType = typeof trigger.taskType === "string" ? trigger.taskType : NO_TASK_TYPE;
    const body = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>) : {};
    const deliveryRepo =
      typeof body[REPO_DELIVERY_KEY] === "string" ? body[REPO_DELIVERY_KEY].trim() : "";
    const rawMode =
      typeof body[EXEC_MODE_DELIVERY_KEY] === "string"
        ? (body[EXEC_MODE_DELIVERY_KEY] as string).trim().toLowerCase()
        : typeof body[EXEC_MODE_DELIVERY_ALIAS] === "string"
          ? (body[EXEC_MODE_DELIVERY_ALIAS] as string).trim().toLowerCase()
          : "";
    const deliveryMode = (EXEC_MODE_VALUES as readonly string[]).includes(rawMode)
      ? (rawMode as "local" | "cloud") : undefined;
    let repoId = typeof trigger.repoId === "string" ? trigger.repoId : "";
    if (deliveryRepo) {
      const deliveryRepoRow = await db.repoById(deliveryRepo)
        ?? await db.repoByCloudUrl(deliveryRepo)
        ?? (await db.listRepos()).find((r) => r.name === deliveryRepo);
      if (!deliveryRepoRow) {
        throw new Error(
          `the delivery's "${REPO_DELIVERY_KEY}" doesn't match a registered repo — ` +
          `use the repo's id, URL or name`);
      }
      repoId = deliveryRepoRow.id;
    }
    if (!repoId) {
      throw new Error(
        `template "${t.name}" has no repo binding — schedule fires and webhook ` +
        `deliveries auto-create flows, so either bind a repo in the template ` +
        `editor's flow settings or pass "${REPO_DELIVERY_KEY}" in the payload`);
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
      delete contractPayload[REPO_DELIVERY_KEY];
      delete contractPayload[EXEC_MODE_DELIVERY_KEY];
      delete contractPayload[EXEC_MODE_DELIVERY_ALIAS];
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
