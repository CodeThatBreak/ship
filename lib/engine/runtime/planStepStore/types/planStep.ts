import "server-only";

export interface PlanStepInput {
  id?: string; // agent-emitted steps: the planner's meta_id; editor payloads: the plan_steps row id
  title: string;
  detail?: string;
  files?: string[];
  branch?: string | null;
}

export interface PlanStepRow {
  id: string;
  flowId: string;
  artifactId: string | null;
  metaId: string | null;
  position: number;
  title: string;
  detail: string | null;
  files: string | null; // JSON array (serialized on read for legacy consumers)
  branch: string | null;
  status: string; // pending | done
  origin: string; // agent | user
  completedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PlanStepDelegate = import("@prisma/client").Prisma.PlanStepDelegate;
