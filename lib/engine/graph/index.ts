import "server-only";

import { processSingleton } from "../../singleton";
import { GraphService } from "./graph-service";

export const graphService = processSingleton("graphService", () => new GraphService());

export { GraphService } from "./graph-service";
export type { GraphApiPayload } from "./graph-service";
