import "server-only";

import type { TriggerResult, TriggerSource } from "../triggers/types/triggerGateway";

export type CommentIngestorHost = {
  /** the SDLC builtin chain (step 07: the facade no longer re-exports the
   *  chain's stage entries — callers drive the chain directly) */
  chain: {
    triggerPipelineGate(flowId: string, pipelineId?: number, model?: string, source?: TriggerSource): Promise<TriggerResult>;
  };
};
