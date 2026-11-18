import "server-only";

import type { JobKind, JobStatus } from "../constants/jobVocabulary";

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
