import "server-only";

import type { z } from "zod";
import { ArtifactRow, Task } from "../../../../db/rows";
import type { Artifact, FlowData } from "@/types/flow";

/**
 * ORM-row helpers for the flow read model: the row decode/narrow semantics and
 * the row→UI mappers the snapshot assembly uses. JSONB payloads stay narrowed
 * through the rows.ts zod schemas (`lib/db/rows.ts`).
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

/** Narrow a Prisma row through its rows.ts schema (JSONB payloads + Date → ISO). */
export const parseRow = <S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> | undefined => {
  const result = schema.safeParse(raw);
  return result.success ? result.data : undefined;
};

/** Narrow Prisma rows through their rows.ts schema, skipping undecodable rows. */
export const parseRows = <S extends z.ZodTypeAny>(schema: S, raws: readonly unknown[]): z.infer<S>[] => {
  const parsed: z.infer<S>[] = [];
  for (const raw of raws) {
    const result = schema.safeParse(raw);
    if (result.success) parsed.push(result.data);
    else
      console.error("[flowReadModel] skipping undecodable row", {
        issues: result.error.issues,
      });
  }
  return parsed;
};

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
  created_at: art.createdAt,
  feedback: art.feedback ?? undefined,
  meta: art.meta ?? undefined,
});
