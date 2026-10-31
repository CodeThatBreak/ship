import "server-only";

import { processSingleton } from "../singleton";
import { ArtifactService } from "./artifact-service";

export const artifactService = processSingleton("artifactService", () => new ArtifactService());

export { ArtifactService } from "./artifact-service";
