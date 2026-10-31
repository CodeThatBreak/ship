import "server-only";

import { db } from "../../db/app";
import { NODE_KEYS } from "../constants/nodeKeys";
import { childFlowHasStarted, isNodeStarted } from "../constants/nodeStatus";
import { nodeStore } from "./nodeStore";

// ── Structured plan steps ────────────────────────────────────────────────────
// The live, editable checklist behind the Plan view. Agent-emitted steps are
// synced from each plan version's plan-meta block; human edits (retitle,
// reorder, add, delete, toggle) mutate these rows directly.

export interface PlanStepInput {
  id?: string; // agent-emitted steps: the planner's meta_id; editor payloads: the plan_steps row id
  title: string;
  detail?: string;
  files?: string[];
  branch?: string | null;
}

export interface PlanStepRow {
  id: string;
  flow_id: string;
  artifact_id: string | null;
  meta_id: string | null;
  position: number;
  title: string;
  detail: string | null;
  files: string | null; // JSON array
  branch: string | null;
  status: string; // pending | done
  origin: string; // agent | user
  completed_by: string | null;
  sub_flow_id: string | null; // step ⇄ sub-flow linkage (plan fan-out)
  created_at: string;
  updated_at: string;
}

/**
 * Store for the structured plan-step checklist: sync from agent plan-meta,
 * human bulk edits, status toggles, and build-progress application.
 */
export class PlanStepStore {
  list(flowId: string): PlanStepRow[] {
    return db.all<PlanStepRow>(
      `SELECT * FROM plan_steps WHERE flow_id=? ORDER BY position, created_at`,
      flowId
    );
  }

  /** Pending steps as a Markdown checklist — injected into the build prompt. */
  markdown(flowId: string, branch?: string | null): string {
    const rows = this.list(flowId).filter(
      (s) => s.status === "pending" && (branch == null || !s.branch || s.branch === branch)
    );
    if (!rows.length) return "";
    return rows
      .map((s) => `- [${s.meta_id ?? s.id}] ${s.title}${s.detail ? ` — ${s.detail}` : ""}`)
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
  syncFromPlan(flowId: string, artifactId: string, steps: PlanStepInput[]): number {
    const existingAgent = db.all<PlanStepRow>(
      `SELECT * FROM plan_steps WHERE flow_id=? AND origin='agent'`,
      flowId
    );
    const byMetaId = new Map(
      existingAgent
        .filter((s): s is PlanStepRow & { meta_id: string } => s.meta_id != null)
        .map((s) => [s.meta_id, s]),
    );
    const seen = new Set<string>();
    const ts = db.now();
    let maxPos =
      db.get<{ p: number | null }>(`SELECT MAX(position) p FROM plan_steps WHERE flow_id=?`, flowId)?.p ?? -1;

    for (const step of steps) {
      const metaId = step.id ?? null;
      const prev = metaId ? byMetaId.get(metaId) : undefined;
      if (prev) {
        seen.add(prev.id);
        if (prev.status !== "done") {
          db.run(
            `UPDATE plan_steps SET artifact_id=?, title=?, detail=?, files=?, branch=?, updated_at=? WHERE id=?`,
            artifactId,
            step.title,
            step.detail ?? null,
            JSON.stringify(step.files ?? []),
            step.branch ?? null,
            ts,
            prev.id
          );
        } else {
          // keep the record current with the latest plan version, but never reopen done work
          db.run(`UPDATE plan_steps SET artifact_id=?, updated_at=? WHERE id=?`, artifactId, ts, prev.id);
        }
      } else {
        db.run(
          `INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,'pending','agent',?,?)`,
          db.uid("step_"),
          flowId,
          artifactId,
          metaId,
          ++maxPos,
          step.title,
          step.detail ?? null,
          JSON.stringify(step.files ?? []),
          step.branch ?? null,
          ts,
          ts
        );
      }
    }

    // supersede agent steps that vanished from the new plan version — with the
    // fan-out guard: a step whose child has started/merged survives the refine
    const guard = this.deletableGuard(flowId);
    for (const prev of existingAgent) {
      if (!seen.has(prev.id) && prev.artifact_id !== artifactId) {
        if (guard.built.has(prev.id)) continue; // sub-flow running/merged — kept, not deleted
        this.cancelChildFlow(guard.cancelable.get(prev.id) ?? null);
        db.run(`DELETE FROM plan_steps WHERE id=?`, prev.id);
      }
    }
    return steps.length;
  }

  /** Replace the full step list from the Plan view's editor (bulk save).
   *  Matched rows update in place (status, origin, meta_id, sub_flow_id preserved).
   *  Started/merged fan-out steps keep their editor index; unmatched survivors
   *  append at the tail. Rows removed from the editor are deleted (pending
   *  children cancelled via flowEngine guards). */
  replace(
    flowId: string,
    artifactId: string | null,
    steps: PlanStepInput[],
    opts: { matchedRows?: Map<number, string> } = {},
  ): PlanStepRow[] {
    const ts = db.now();
    const guard = this.deletableGuard(flowId);
    const existing = this.list(flowId);
    const existingById = new Map(existing.map((s) => [s.id, s]));
    const survivors = existing.filter((s) => guard.built.has(s.id));
    const matchedRows = opts.matchedRows ?? new Map<number, string>();

    db.transaction(() => {
      const kept = new Set<string>();

      for (const [i, s] of steps.entries()) {
        const rowId = matchedRows.get(i);
        const prev = rowId ? existingById.get(rowId) : undefined;
        if (prev) {
          kept.add(prev.id);
          db.run(
            `UPDATE plan_steps SET artifact_id=?, position=?, title=?, detail=?, files=?, branch=?, updated_at=? WHERE id=? AND flow_id=?`,
            artifactId,
            i,
            s.title,
            s.detail ?? null,
            JSON.stringify(s.files ?? []),
            s.branch ?? null,
            ts,
            prev.id,
            flowId
          );
        } else {
          const newId = db.uid("step_");
          kept.add(newId);
          db.run(
            `INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,sub_flow_id,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,'pending','user',?,?,?)`,
            newId,
            flowId,
            artifactId,
            null,
            i,
            s.title,
            s.detail ?? null,
            JSON.stringify(s.files ?? []),
            s.branch ?? null,
            null,
            ts,
            ts
          );
        }
      }

      let tail = steps.length;
      for (const survivor of survivors) {
        if (kept.has(survivor.id)) continue;
        kept.add(survivor.id);
        db.run(
          `UPDATE plan_steps SET position=?, updated_at=? WHERE id=? AND flow_id=?`,
          tail++,
          ts,
          survivor.id,
          flowId
        );
      }

      for (const row of existing) {
        if (kept.has(row.id)) continue;
        this.cancelChildFlow(guard.cancelable.get(row.id) ?? null);
        db.run(`DELETE FROM plan_steps WHERE id=?`, row.id);
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
  replaceBranch(flowId: string, artifactId: string, branchName: string, steps: PlanStepInput[]): number {
    const ts = db.now();
    const existing = this.list(flowId).filter((s) => s.branch === branchName);
    if (!existing.length && !steps.length) return 0;
    // fan-out guard: rows whose child sub-flow started/merged are rebuilt with
    // their linkage intact (status/completed_by/sub_flow_id survive the refine)
    const guard = this.deletableGuard(flowId);
    const stateByMetaId = new Map(
      existing
        .filter((s): s is PlanStepRow & { meta_id: string } => s.meta_id != null)
        .map((s) => [s.meta_id, s]),
    );
    const firstPos = existing.length ? existing[0].position : 0;
    db.transaction(() => {
      db.run(
        `DELETE FROM plan_steps WHERE flow_id=? AND branch=?`,
        flowId, branchName
      );
      steps.forEach((s, i) => {
        const prev = s.id ? stateByMetaId.get(s.id) : undefined;
        const status = prev?.status ?? "pending";
        const completedBy = status === "done" ? prev?.completed_by ?? "manual" : null;
        db.run(
          `INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,completed_by,sub_flow_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          db.uid("step_"),
          flowId,
          artifactId,
          s.id ?? null,
          firstPos + i,
          s.title,
          s.detail ?? null,
          JSON.stringify(s.files ?? []),
          branchName,
          status,
          "agent",
          completedBy,
          prev?.sub_flow_id ?? null,
          ts,
          ts
        );
      });
    });
    return steps.length;
  }

  /**
   * Fan-out deletion guard: which linked steps are protected (a child that has
   * started/merged) and which pending children a removal would cancel. No
   * fan-out rows → a no-op; whole-mode checklists never touch these paths.
   */
  private deletableGuard(flowId: string): { built: Set<string>; cancelable: Map<string, string> } {
    const linked = db.all<{ id: string; sub_flow_id: string | null }>(
      `SELECT id, sub_flow_id FROM plan_steps WHERE flow_id=? AND sub_flow_id IS NOT NULL`, flowId
    );
    const built = new Set<string>();
    const cancelable = new Map<string, string>();
    for (const s of linked) {
      if (!s.sub_flow_id) continue;
      const started = childFlowHasStarted(nodeStore.statusesOfFlow(s.sub_flow_id));
      if (started) built.add(s.id);
      else cancelable.set(s.id, s.sub_flow_id);
    }
    return { built, cancelable };
  }

  /** Close a child flow on checklist removal (child with no run). */
  private cancelChildFlow(childFlowId: string | null): void {
    if (!childFlowId) return;
    const started = db.all<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=?`, childFlowId
    ).some((n) => isNodeStarted(n.status));
    if (started) return; // never closed silently
    db.run(`UPDATE flows SET status='done', updated_at=? WHERE id=? AND status<>'done'`, db.now(), childFlowId);
  }

  setStatus(
    flowId: string,
    stepId: string,
    status: "pending" | "done",
    completedBy: string | null
  ): boolean {
    const res = db.run(
      `UPDATE plan_steps SET status=?, completed_by=?, updated_at=? WHERE id=? AND flow_id=?`,
      status,
      status === "done" ? completedBy ?? "manual" : null,
      db.now(),
      stepId,
      flowId
    );
    return res.changes > 0;
  }

  /** Parse the build agent's trailing ```json build-progress``` block. */
  parseBuildProgress(text: string): string[] {
    const m = text.match(/```json build-progress\s*\n([\s\S]*?)```/);
    if (!m) return [];
    try {
      const parsed = JSON.parse(m[1]);
      if (!Array.isArray(parsed?.completed)) return [];
      return parsed.completed.filter((x: unknown) => typeof x === "string");
    } catch {
      return [];
    }
  }

  /**
   * Mark steps done from the build agent's progress report. Matches by meta_id
   * first, then by exact title (case-insensitive). Emits one lifecycle event
   * summarising what was checked off.
   */
  markDone(flowId: string, nodeId: string | null, refs: string[]): number {
    if (!refs.length) return 0;
    const rows = this.list(flowId).filter((s) => s.status !== "done");
    const norm = (s: string) => s.trim().toLowerCase();
    const want = new Set(refs.map(norm));
    const done: string[] = [];
    for (const s of rows) {
      if ((s.meta_id && want.has(norm(s.meta_id))) || want.has(norm(s.title))) {
        this.setStatus(flowId, s.id, "done", NODE_KEYS.BUILD);
        done.push(s.title);
      }
    }
    if (done.length) {
      db.emitEvent(
        flowId,
        nodeId,
        "lifecycle",
        `build checked off ${done.length} plan step${done.length > 1 ? "s" : ""}: ${done.join("; ")}`
      );
    }
    return done.length;
  }
}

export const planSteps = new PlanStepStore();
