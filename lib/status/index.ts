import "server-only";

import { db } from "../db";
import { processSingleton } from "../singleton";
import { StatusService } from "./status-service";

export const statusService = processSingleton("statusService", () => new StatusService(db));

export { StatusService } from "./status-service";
export type { StatusSnapshot } from "./status-service";
