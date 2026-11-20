import "server-only";

import { db } from "../../../db/app";
import type { Prisma } from "@prisma/client";
import type { QueryExecutor } from "../../../db/database";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { childFlowHasStarted, isNodeStarted } from "../transitions/constants/statusSets";
import type { PlanStepDelegate, PlanStepInput, PlanStepRow } from "./types/planStep";
import { toRow } from "./utils/toPlanStepRow";
import { engineParts } from "@/lib/composition/container";

export class PlanStepStore {
  async list(flowId: string, tx?: QueryExecutor): Promise<PlanStepRow[]> {
    const rows = await (tx ?? db.prisma).planStep.findMany({
      where: { flowId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(toRow);
  }

  /** Pending steps as a Markdown checklist — injected into the build prompt. */
  async markdown(flowId: string, branch?: string | null): Promise<string> {
    const rows = (await this.list(flowId)).filter(
      (s) => s.status === "pending" && (branch == null || !s.branch || s.branch === branch)
    );
    if (!rows.length) return "";
    return rows
      .map((s) => `- [${s.metaId ?? s.id}] ${s.title}${s.detail ? ` — ${s.detail}` : ""}`)
      .join("\n");
  }

  /**
   * Sync steps from a plan version's plan-meta into plan_steps.
   * - agent steps are matched across versions by meta_id (so refine keeps a
   *   step's done state when it survives the revision)
   * - manual (user-added) steps are never touched
   * - steps already done keep their status even when re-synced
   * Returns the number of steps the new version contributed.
   */
  async syncFromPlan(flowId: string, artifactId: string, steps: PlanStepInput[]): Promise<number> {
    const existingAgent = (await db.prisma.planStep.findMany({
      where: { flowId, origin: "agent" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    })).map(toRow);
    const byMetaId = new Map(
      existingAgent
        .filter((s): s is PlanStepRow & { metaId: string } => s.metaId != null)
        .map((s) => [s.metaId, s]),
    );
    const seen = new Set<string>();
    const ts = new Date();
    let maxPos =
      (await db.prisma.planStep.aggregate({
        where: { flowId },
        _max: { position: true },
      }))._max.position ?? -1;

    for (const step of steps) {
      const metaId = step.id ?? null;
      const prev = metaId ? byMetaId.get(metaId) : undefined;
      if (prev) {
        seen.add(prev.id);
        if (prev.status !== "done") {
          await db.prisma.planStep.update({
            where: { id: prev.id },
            data: {
              artifactId,
              title: step.title,
              detail: step.detail ?? null,
              files: step.files ?? [],
              branch: step.branch ?? null,
              updatedAt: ts,
            },
          });
        } else {
          // keep the record current with the latest plan version, but never reopen done work
          await db.prisma.planStep.update({
            where: { id: prev.id },
            data: { artifactId, updatedAt: ts },
          });
        }
      } else {
        await db.prisma.planStep.create({
          data: {
            id: db.uid("step_"),
            flowId,
            artifactId,
            metaId,
            position: ++maxPos,
            title: step.title,
            detail: step.detail ?? null,
            files: step.files ?? [],
            branch: step.branch ?? null,
            status: "pending",
            origin: "agent",
            createdAt: ts,
            updatedAt: ts,
          },
        });
      }
    }

    // supersede agent steps that vanished from the new plan version — with the
    // fan-out guard: a step whose child has started/merged survives the refine
    const guard = await this.deletableGuard(flowId);
    for (const prev of existingAgent) {
      if (!seen.has(prev.id) && prev.artifactId !== artifactId) {
        if (guard.built.has(prev.id)) continue; // sub-flow running/merged — kept, not deleted
        await this.cancelChildFlow(guard.cancelable.get(prev.id) ?? null);
        await db.prisma.planStep.delete({ where: { id: prev.id } });
      }
    }
    return steps.length;
  }

  /** Replace the full step list from the Plan view's editor (bulk save).
   *  Matched rows update in place (status, origin, meta_id, sub_flow_id preserved).
   *  Started/merged fan-out steps keep their editor index; unmatched survivors
   *  append at the tail. Rows removed from the editor are deleted (pending
   *  children cancelled via flowEngine guards). */
  async replace(
    flowId: string,
    artifactId: string | null,
    steps: PlanStepInput[],
    opts: { matchedRows?: Map<number, string> } = {},
  ): Promise<PlanStepRow[]> {
    const ts = new Date();
    const guard = await this.deletableGuard(flowId);
    const existing = await this.list(flowId);
    const existingById = new Map(existing.map((s) => [s.id, s]));
    const survivors = existing.filter((s) => guard.built.has(s.id));
    const matchedRows = opts.matchedRows ?? new Map<number, string>();

    await db.transaction(async (tx) => {
      const stepTx: PlanStepDelegate = tx.planStep;
      const kept = new Set<string>();

      for (const [i, s] of steps.entries()) {
        const rowId = matchedRows.get(i);
        const prev = rowId ? existingById.get(rowId) : undefined;
        if (prev) {
          kept.add(prev.id);
          await stepTx.update({
            where: { id: prev.id },
            data: {
              artifactId,
              position: i,
              title: s.title,
              detail: s.detail ?? null,
              files: s.files ?? [],
              branch: s.branch ?? null,
              updatedAt: ts,
            },
          });
        } else {
          const newId = db.uid("step_");
          kept.add(newId);
          await stepTx.create({
            data: {
              id: newId,
              flowId,
              artifactId,
              metaId: null,
              position: i,
              title: s.title,
              detail: s.detail ?? null,
              files: s.files ?? [],
              branch: s.branch ?? null,
              status: "pending",
              origin: "user",
              subFlowId: null,
              createdAt: ts,
              updatedAt: ts,
            },
          });
        }
      }

      let tail = steps.length;
      for (const survivor of survivors) {
        if (kept.has(survivor.id)) continue;
        kept.add(survivor.id);
        await stepTx.update({
          where: { id: survivor.id },
          data: { position: tail++, updatedAt: ts },
        });
      }

      for (const row of existing) {
        if (kept.has(row.id)) continue;
        await this.cancelChildFlow(guard.cancelable.get(row.id) ?? null, tx);
        await stepTx.delete({ where: { id: row.id } });
      }
    });
    return this.list(flowId);
  }

  /**
   * Scoped checklist sync for a branch refine: replace this branch's agent
   * rows in place — rows of other branches are never touched. Manual (user)
   * rows of the branch are removed because the refine's `currentSteps` input
   * (built from live rows) echoed them, so user intent flows back in, not out.
   * Steps whose meta_id survives keep their done state, like syncFromPlan.
   */
  async replaceBranch(flowId: string, artifactId: string, branchName: string, steps: PlanStepInput[]): Promise<number> {
    const ts = new Date();
    const existing = (await this.list(flowId)).filter((s) => s.branch === branchName);
    if (!existing.length && !steps.length) return 0;
    // fan-out guard: rows whose child sub-flow started/merged are rebuilt with
    // their linkage intact (status/completed_by/sub_flow_id survive the refine)
    await this.deletableGuard(flowId);
    const stateByMetaId = new Map(
      existing
        .filter((s): s is PlanStepRow & { metaId: string } => s.metaId != null)
        .map((s) => [s.metaId, s]),
    );
    const firstPos = existing.length ? existing[0].position : 0;
    await db.transaction(async (tx) => {
      const stepTx: PlanStepDelegate = tx.planStep;
      await stepTx.deleteMany({ where: { flowId, branch: branchName } });
      for (const [i, s] of steps.entries()) {
        const prev = s.id ? stateByMetaId.get(s.id) : undefined;
        const status = prev?.status === "done" ? "done" : "pending";
        const completedBy = status === "done" ? prev?.completedBy ?? "manual" : null;
        await stepTx.create({
          data: {
            id: db.uid("step_"),
            flowId,
            artifactId,
            metaId: s.id ?? null,
            position: firstPos + i,
            title: s.title,
            detail: s.detail ?? null,
            files: s.files ?? [],
            branch: branchName,
            status,
            origin: "agent",
            completedBy,
            subFlowId: prev?.subFlowId ?? null,
            createdAt: ts,
            updatedAt: ts,
          },
        });
      }
    });
    return steps.length;
  }

  /**
   * Fan-out deletion guard: which linked steps are protected (a child that has
   * started/merged) and which pending children a removal would cancel. No
   * fan-out rows → a no-op; whole-mode checklists never touch these paths.
   */
  private async deletableGuard(flowId: string): Promise<{ built: Set<string>; cancelable: Map<string, string> }> {
    const linked = await db.prisma.planStep.findMany({
      where: { flowId, subFlowId: { not: null } },
      select: { id: true, subFlowId: true },
    });
    const built = new Set<string>();
    const cancelable = new Map<string, string>();
    for (const s of linked) {
      if (!s.subFlowId) continue;
      const started = childFlowHasStarted(await engineParts.nodeStore.statusesOfFlow(s.subFlowId));
      if (started) built.add(s.id);
      else cancelable.set(s.id, s.subFlowId);
    }
    return { built, cancelable };
  }

  /** Close a child flow on checklist removal (child with no run). */
  private async cancelChildFlow(childFlowId: string | null, tx?: Prisma.TransactionClient): Promise<void> {
    if (!childFlowId) return;
    const client = tx ?? db.prisma;
    const nodes = await client.node.findMany({
      where: { flowId: childFlowId },
      select: { status: true },
    });
    if (nodes.some((n) => isNodeStarted(n.status))) return; // never closed silently
    await client.flow.updateMany({
      where: { id: childFlowId, status: { not: "done" } },
      data: { status: "done", updatedAt: new Date() },
    });
  }

  async setStatus(
    flowId: string,
    stepId: string,
    status: "pending" | "done",
    completedBy: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await (tx ?? db.prisma).planStep.updateMany({
      where: { id: stepId, flowId },
      data: {
        status,
        completedBy: status === "done" ? completedBy ?? "manual" : null,
        updatedAt: new Date(),
      },
    });
    return count > 0;
  }

  /**
   * Mark steps done from the build agent's progress report — by step id
   * (meta_id) ONLY (step 05: the case-insensitive title salvage is deleted;
   * a report naming titles instead of ids matches nothing, which the build
   * def's missing-report gate surfaces). Emits one lifecycle event
   * summarising what was checked off.
   */
  async markDone(flowId: string, nodeId: string | null, refs: string[]): Promise<number> {
    if (!refs.length) return 0;
    const rows = (await this.list(flowId)).filter((s) => s.status !== "done");
    const want = new Set(refs);
    const done: string[] = [];
    for (const s of rows) {
      if (s.metaId && want.has(s.metaId)) {
        await this.setStatus(flowId, s.id, "done", NODE_KEYS.BUILD);
        done.push(s.title);
      }
    }
    if (done.length) {
      await db.emitEvent(
        flowId,
        nodeId,
        "lifecycle",
        `build checked off ${done.length} plan step${done.length > 1 ? "s" : ""}: ${done.join("; ")}`
      );
    }
    return done.length;
  }
}

