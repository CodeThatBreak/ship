import "server-only";

import { db } from "../../db/app";
import { FlowRow, Task, rows } from "../../db/rows";
import { NotFoundError, ValidationError } from "../../errors";
import { FLOW_KIND } from "../constants/flowKind";
import { nodeRegistry } from "../nodes/registry";
import { nodeStore } from "./nodeStore";
import { parseStartContract, validateAgainstContract } from "../nodes/kinds/start/contract";
import { NO_TASK_TYPE, SDLC_TEMPLATE_ID, templateStore } from "../templates/templateStore";
import type { StepChildPayload } from "./fanout/stepFlowManager";
import type { SplitChildPayload } from "./split/splitManager";
import type { FlowFactoryHost } from "./flowEngineHost";

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

  create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): string {
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!task) throw new NotFoundError("task", taskId);
    const repo = opts.repoId ? db.repoById(opts.repoId) : undefined;
    if (repo) repoUrl = repo.cloud_url;
    const executionMode = opts.executionMode === "local" ? "local" : "cloud";
    if (executionMode === "local" && !repo?.local_path) {
      throw new ValidationError(
        "Local mode requires a repo registered on the Settings page with a local path.",
      );
    }
    const templateId = opts.templateId ?? SDLC_TEMPLATE_ID;
    const graph = templateStore.graph(templateId);
    if (!graph) throw new NotFoundError("flow template", templateId);
    const declaredType = typeof graph.flowTrigger.task_type === "string" ? graph.flowTrigger.task_type : null;
    if (declaredType && task.type !== declaredType) {
      throw new ValidationError(
        `task ${task.key} is a "${task.type}" task but template "${templateStore.flowTemplate(templateId)?.name ?? templateId}" ` +
        `declares "${declaredType}" task context — pick a ${declaredType} task or change the template's task type`,
      );
    }

    const id = db.uid("flow_");
    const ts = db.now();
    db.transaction(() => {
      db.run(
        `INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id, taskId, name ?? `${task.key} flow`, "active", repoUrl, repo?.id ?? null, executionMode,
        graph.templateId, opts.triggerPayload != null ? JSON.stringify(opts.triggerPayload) : null, ts, ts
      );
      nodeStore.insertSnapshots(id, graph, { provisionWebhookHooks: true, ts });
      templateStore.persistFlowGraphSnapshot(id, graph);
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

  createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: StepChildPayload,
    opts: { branch: string | null },
  ): string {
    const parent = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, parentFlowId);
    if (!parent) throw new NotFoundError("flow", parentFlowId);
    const graph = templateStore.graph(templateId);
    if (!graph) throw new NotFoundError("flow template", templateId);
    const startSpec = graph.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (contractFields.length) {
      const v = validateAgainstContract(contractFields, payload);
      if (!v.ok) {
        throw new Error(
          `payload doesn't match the step child's start contract (template "${templateStore.flowTemplate(templateId)?.name ?? templateId}") — ${v.error}`);
      }
    }
    const id = db.uid("flow_");
    const ts = db.now();
    db.transaction(() => {
      db.run(
        `INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,mr_branch,parent_flow_id,kind,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, parent.task_id, name, "active", parent.repo_url, parent.repo_id, parent.execution_mode,
        graph.templateId, JSON.stringify(payload), opts.branch, parentFlowId, FLOW_KIND.STEP, ts, ts
      );
      nodeStore.insertSnapshots(id, graph, { ts });
      templateStore.persistFlowGraphSnapshot(id, graph);
      db.emitEvent(id, null, "lifecycle",
        `step child created from "${templateStore.flowTemplate(templateId)?.name ?? templateId}" — parent flow ${parentFlowId}`);
    });
    return id;
  }

  createSplitChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SplitChildPayload,
  ): string {
    const parent = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, parentFlowId);
    if (!parent) throw new NotFoundError("flow", parentFlowId);
    const graph = templateStore.graph(templateId);
    if (!graph) throw new NotFoundError("flow template", templateId);
    const id = db.uid("flow_");
    const ts = db.now();
    db.transaction(() => {
      db.run(
        `INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,parent_flow_id,kind,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, parent.task_id, name, "active", parent.repo_url, parent.repo_id, parent.execution_mode,
        graph.templateId, JSON.stringify(payload), parentFlowId, FLOW_KIND.SPLIT, ts, ts
      );
      nodeStore.insertSnapshots(id, graph, { ts });
      templateStore.persistFlowGraphSnapshot(id, graph);
      db.emitEvent(id, null, "lifecycle",
        `split child created from "${templateStore.flowTemplate(templateId)?.name ?? templateId}" — parent flow ${parentFlowId}`);
    });
    return id;
  }

  startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): string {
    const t = templateStore.flowTemplate(templateId);
    if (!t) throw new NotFoundError("template", templateId);
    const trigger = templateStore.graph(templateId)?.flowTrigger ?? {};
    const taskType = typeof trigger.task_type === "string" ? trigger.task_type : NO_TASK_TYPE;
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
    let repoId = typeof trigger.repo_id === "string" ? trigger.repo_id : "";
    if (deliveryRepo) {
      const deliveryRepoRow = db.repoById(deliveryRepo)
        ?? db.repoByCloudUrl(deliveryRepo)
        ?? db.listRepos().find((r) => r.name === deliveryRepo);
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
      const existing = db.get<{ type: string }>(`SELECT type FROM tasks WHERE id=?`, taskId);
      if (!existing) throw new NotFoundError("task", taskId);
      if (existing.type !== taskType) {
        throw new Error(
          `task is a "${existing.type}" task but template "${t.name}" declares "${taskType}" task context — pick a ${taskType} task or change the template's task type`);
      }
    } else {
      const latest = db.get<{ id: string }>(
        `SELECT id FROM tasks WHERE type=? ORDER BY synced_at DESC, rowid DESC LIMIT 1`, taskType
      );
      if (!latest) {
        throw new Error(
          `template "${t.name}" runs on ${taskType} tasks but none are imported yet — import one on the task import screen first`);
      }
      taskId = latest.id;
    }
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!task) throw new NotFoundError("task", taskId);
    const repo = db.repoById(repoId);
    if (!repo) {
      throw new ValidationError(
        "the template's bound repo no longer exists — rebind in the template editor",
      );
    }
    const startSpec = templateStore.graph(templateId)?.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
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
    const id = this.create(taskId, repo.cloud_url, `${t.name} · ${new Date().toISOString()}`, {
      repoId,
      executionMode: deliveryMode ?? (repo.local_path ? "local" : "cloud"),
      templateId,
      triggerPayload: payload,
      autoStart: true,
    });
    db.emitEvent(id, null, "lifecycle", `flow auto-created from the "${t.name}" template by a trigger — ${taskType} task ${task.key}`);
    return id;
  }
}
