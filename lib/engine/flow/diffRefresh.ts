import "server-only";

import { flowEngine } from "../flowEngine";
import { FlowDiffRefreshService } from "./flowDiffRefreshService";

/**
 * Process pin for the diff fact's refresh service (decision Q9 — the
 * runContext pin pattern): the class file stays pure, the instance is pinned
 * here. The host is the flowEngine singleton — the service reads the flow
 * context through it and emits the refresh on the flow's feed.
 */
export const diffRefresh = new FlowDiffRefreshService(flowEngine);