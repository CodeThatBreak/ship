import "server-only";

import { ArtifactRow, Task } from "../../../../db/rows";
import type { Artifact, FlowData } from "@/types/flow";

/**
 * Feature-local row→UI mappers for the flow read model. The shared row-decode
 * helpers (`parseRow`/`parseRowTolerant`/`parseRows`) live in
 * `lib/db/ormRowHelpers.ts`; what stays here is the read model's own
 * projections.
 */

export type NodeTemplateRow = {
  id: string;
  key: string;
  name: string;
  kind: string;
  icon: string | null;
  isBuiltin: boolean;
};

/** Snapshot artifact row — the body is lazy-loaded via GET /api/artifacts/:id. */
export const ArtifactListRow = ArtifactRow.omit({ content: true });

export const buildNodeTemplateIndex = (ntRows: NodeTemplateRow[]) => {
  const byId = new Map<string, NodeTemplateRow>();
  const byBuiltinKey = new Map<string, NodeTemplateRow>();
  for (const r of ntRows) {
    byId.set(r.id, r);
    if (r.isBuiltin) byBuiltinKey.set(r.key, r);
  }
  return (type: string) => byId.get(type) ?? byBuiltinKey.get(type) ?? null;
};

export const toFlowTask = (task: Task): FlowData["task"] => ({
  key: task.key,
  summary: task.summary,
  status: task.status ?? "",
  issueType: task.issueType ?? "",
  priority: task.priority ?? "",
  prdText: task.prdText,
  figmaUrls: task.figmaUrls,
  externalUrl: task.externalUrl ?? "",
});

export const toFlowArtifact = (art: ArtifactRow): Artifact => ({
  id: art.id,
  kind: art.kind,
  version: art.version,
  status: art.status,
  createdAt: art.createdAt,
  feedback: art.feedback ?? undefined,
  meta: art.meta ?? undefined,
});
