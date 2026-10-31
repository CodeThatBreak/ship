import "server-only";

import { agentPortRegistry } from "../engine/ports/agent-port";
import { processSingleton } from "../singleton";
import { ModelCatalogService } from "./model-catalog-service";

export const modelCatalogService = processSingleton(
  "modelCatalogService",
  () => new ModelCatalogService(agentPortRegistry),
);

export { ModelCatalogService } from "./model-catalog-service";
export type { ModelCatalogPayload } from "./model-catalog-service";
