import "server-only";

import { pinnedProcessService } from "../../../composition/processServices";
import { LocalAgentHostClient } from "./hostClient";

/**
 * The one local-agent host client per web process, pinned through the
 * process-services container (decision Q9): its pending-call map and the single
 * child process it supervises are process-bound state, so per-module-graph
 * copies would disagree about which calls are in flight.
 */
export const localAgentHost = pinnedProcessService(
  "localAgentHost",
  () => new LocalAgentHostClient(),
);
