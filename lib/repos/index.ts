import "server-only";

import { db } from "../db";
import { processSingleton } from "../singleton";
import { RepoService } from "./repo-service";

export const repoService = processSingleton("repoService", () => new RepoService(db));

export { RepoService } from "./repo-service";
