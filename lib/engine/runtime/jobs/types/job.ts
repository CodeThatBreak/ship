import "server-only";

import type { JobKind, JobStatus } from "../constants/jobVocabulary";
import type { FlowCtx } from "../../../nodes/shared/nodeSharedExports";
import type { EngineNodeStatus } from "../../../constants/nodeStatus";
import type { TransitionKey } from "../../transitions/types/transitions";

/** What a webhook dispatch did — the routes echo it, the worker sweep ignores it. */
export type WebhookDispatchResult = {
  startedFlowId?: string;
  resumedNodeKey?: string;
};

/**
 * One `jobs` row, camelCase-mapped (step 03). `payload` is validated at the
 * boundary against the kind's schema in `../schemas/jobPayloads.ts` — raw
 * payloads never flow into a dispatcher unvalidated.
 */
export type JobRecord = {
  id: string;
  kind: JobKind;
  flowId: string | null;
  payload: unknown;
  status: JobStatus;
  leaseUntil: Date | null;
  attempts: number;
  dedupKey: string | null;
  runAt: Date;
};

/** What a dispatcher receives: the claimed row with its validated payload. */
export type ClaimedJob<P> = {
  job: JobRecord;
  payload: P;
};

/**
 * Dispatch table the job sweep consults: one handler per job kind that has a
 * dispatcher in this process. Kinds without a registered handler are never
 * claimed (their rows sit queued until the owning step registers one).
 */
export type JobHandlers = Partial<Record<JobKind, (job: JobRecord) => Promise<unknown>>>;

/**
 * The engine surface the MR-create handler needs — injected via the
 * constructor (dependency inversion) instead of importing the flowEngine
 * pin: the handler sits in the class module's import graph
 * (flowEngine/flowEngine.ts → sdlcChain → here), so a module-scope import
 * of the pin would re-close the singleton cycle and read the const before
 * its initialization (TDZ: "FlowEngine is not a constructor").
 */
export type MrCreateEngine = {
  ctx(flowId: string): Promise<FlowCtx>;
  emitMrFailed(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
  setNodeStatus(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts?: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string },
  ): Promise<boolean>;
};

/**
 * What a `runFix` callback resolves to — the creation coordinates the
 * MR-create handler parsed out of the payload, so both dispatch paths (the
 * chain's inline claim and the poller's re-claim) wire the same commit-fix
 * run.
 */
export type MrCreateFixTarget = {
  flowId: string;
  buildKey: string;
  branch: string | null;
  maxAttempts: number;
};
