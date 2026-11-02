import "server-only";

import { ArtifactRow, rows, type ArtifactRow as ArtifactRowType } from "../db/rows";
import { NotFoundError } from "../errors";
import { processSingleton } from "../singleton";

export class ArtifactService {
  get(id: string): ArtifactRowType {
    const art = rows.get(ArtifactRow, `SELECT * FROM artifacts WHERE id=?`, id);
    if (!art) {
      throw new NotFoundError("artifact", id);
    }
    return art;
  }
}

export const artifactService = processSingleton(
  "artifactService",
  () => new ArtifactService(),
);
