import "server-only";

import type { RunMode } from "../../../../../constants/execution";
import type { AgentStartSpec } from "./agentPort";

/**
 * The scripted fake agent port's test-facing vocabulary — the call log the
 * fake records (tests assert at the port boundary instead of engine
 * internals) and the registry identity a constructed instance carries.
 */
export type AgentCall =
  | { kind: "start"; spec: AgentStartSpec }
  | { kind: "followUp"; runId: string; agentId: string | null | undefined; prompt: string | null }
  | { kind: "cancel"; runId: string };

/**
 * The registry identity of a fake agent port instance. The dry-run harness
 * registers the default identity (kind/harness `dry-run`, exec mode
 * `dry-run`); the engine-characterization tests construct cloud-mode
 * instances under their own key so `forMode("cloud")` resolves them.
 */
export interface FakeAgentIdentity {
  kind: string;
  label?: string;
  harness: string;
  execMode: RunMode;
}
