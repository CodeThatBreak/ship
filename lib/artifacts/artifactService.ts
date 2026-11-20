import "server-only";

import { db } from "../db/app";
import { ArtifactRow, type ArtifactRow as ArtifactRowType } from "../db/rows";
import { NotFoundError } from "../errors";
import { parseRow } from "./utils/ormRows";

export class ArtifactService {
  async get(id: string): Promise<ArtifactRowType> {
    const row = await db.prisma.artifact.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundError("artifact", id);
    }
    // The `artifacts.meta` JSONB payload stays narrowed through the shared
    // row mapper (RowGateway.get semantics: RowDecodeError on a bad shape).
    return parseRow(ArtifactRow, row, `artifact ${id}`);
  }
}

/** Shared artifact service (stateless — decision Q9, plain module const). */
export const artifactService = new ArtifactService();
