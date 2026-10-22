import { db } from "../db";
import { NODE_KEYS } from "./nodes/keys";

// ── Structured plan steps ────────────────────────────────────────────────────
// The live, editable checklist behind the Plan view. Agent-emitted steps are
// synced from each plan version's plan-meta block; human edits (retitle,
// reorder, add, delete, toggle) mutate these rows directly.

export interface PlanStepInput {
  id?: string; // meta_id for agent steps
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
    const byMetaId = new Map(existingAgent.filter((s) => s.meta_id).map((s) => [s.meta_id!, s]));
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

    // supersede agent steps that vanished from the new plan version
    for (const prev of existingAgent) {
      if (!seen.has(prev.id) && prev.artifact_id !== artifactId) {
        db.run(`DELETE FROM plan_steps WHERE id=?`, prev.id);
      }
    }
    return steps.length;
  }

  /** Replace the full step list from the Plan view's editor (bulk save). */
  replace(flowId: string, artifactId: string | null, steps: PlanStepInput[]): PlanStepRow[] {
    const ts = db.now();
    db.run(`DELETE FROM plan_steps WHERE flow_id=?`, flowId);
    steps.forEach((s, i) => {
      db.run(
        `INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'pending','user',?,?)`,
        db.uid("step_"),
        flowId,
        artifactId,
        null,
        i,
        s.title,
        s.detail ?? null,
        JSON.stringify(s.files ?? []),
        s.branch ?? null,
        ts,
        ts
      );
    });
    return this.list(flowId);
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
      return parsed.completed.filter((x: any) => typeof x === "string");
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
