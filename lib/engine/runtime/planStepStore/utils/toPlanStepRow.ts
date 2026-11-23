import "server-only";

import type { Prisma } from "@prisma/client";
import type { PlanStepRow } from "../types/planStep";

/** Row shape consumers see (ISO timestamps, `files` as a JSON string). */
export const toRow = (r: {
  id: string;
  flowId: string;
  artifactId: string | null;
  metaId: string | null;
  position: number;
  title: string;
  detail: string | null;
  files: Prisma.JsonValue;
  branch: string | null;
  status: string;
  origin: string;
  completedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PlanStepRow => ({
  id: r.id,
  flowId: r.flowId,
  artifactId: r.artifactId,
  metaId: r.metaId,
  position: r.position,
  title: r.title,
  detail: r.detail,
  files: JSON.stringify(r.files ?? []),
  branch: r.branch,
  status: r.status,
  origin: r.origin,
  completedBy: r.completedBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
