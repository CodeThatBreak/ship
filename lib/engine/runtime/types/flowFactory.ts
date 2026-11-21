import "server-only";

import type { RunMode } from "../../../../constants/execution";

export interface CreateFlowOptions {
  executionMode?: RunMode;
  repoId?: string;
  templateId?: string;
  triggerPayload?: unknown;
  autoStart?: boolean;
}
