import "server-only";

import { ArtifactRow, rows, type ArtifactRow as ArtifactRowType } from "../db/rows";
import { NotFoundError } from "../errors";

export class ArtifactService {
  async get(id: string): Promise<ArtifactRowType> {
    const art = await rows.get(ArtifactRow, `SELECT id, node_id AS "nodeId", flow_id AS "flowId", kind, version, content, meta, status, feedback, created_at AS "createdAt" FROM artifacts WHERE id=$1`, id);
    if (!art) {
      throw new NotFoundError("artifact", id);
    }
    return art;
  }
}

/** Shared artifact service (stateless — decision Q9, plain module const). */
export const artifactService = new ArtifactService();
