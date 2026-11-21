import "server-only";

import type {
  CreateChangeRequestInput,
  InlineCommentInput,
} from "./gitHost";

/**
 * The scripted fake git host's test-facing vocabulary — the write-call log
 * tests assert at the port boundary (create CR / pipeline / comment /
 * resolve / retry / play) — and the registry identity a constructed
 * instance carries.
 */
export type GitHostCall =
  | { kind: "createChangeRequest"; input: CreateChangeRequestInput; repoUrl: string }
  | { kind: "createPipeline"; ref: string; repoUrl: string }
  | { kind: "createCRPipeline"; crNumber: number; repoUrl: string }
  | { kind: "createComment"; crNumber: number; body: string; repoUrl: string }
  | { kind: "createInlineComment"; crNumber: number; input: InlineCommentInput; repoUrl: string }
  | { kind: "resolveComment"; crNumber: number; threadId: string; resolved: boolean; repoUrl: string }
  | { kind: "replyToComment"; crNumber: number; threadId: string; body: string; repoUrl: string }
  | { kind: "retryPipeline"; pipelineId: number; repoUrl: string }
  | { kind: "playJob"; jobId: number; repoUrl: string };

/**
 * The registry identity of a fake git host instance. The dry-run harness
 * registers the default identity under the `dry-run` key and claims NO
 * repos — `forRepo` must never resolve the simulation host by URL; a
 * dry-run flow's host operations select it explicitly by execution mode.
 * The characterization tests construct `claimsAllRepos` instances under
 * their own key so `forRepo` resolves them in the test database.
 */
export interface FakeGitHostIdentity {
  kind: string;
  label?: string;
  claimsAllRepos: boolean;
}
