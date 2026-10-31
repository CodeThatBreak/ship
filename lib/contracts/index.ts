import "server-only";

import { processSingleton } from "../singleton";
import { ContractService } from "./contract-service";

export const contractService = processSingleton("contractService", () => new ContractService());

export { ContractService, contractParamsSchema } from "./contract-service";
export type { ContractParams } from "./contract-service";
