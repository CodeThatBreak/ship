/**
 * Client-safe flow-snapshot types (the payload of the flow engine's serialized
 * snapshot — what `GET /api/flows/:id` returns and the flow cockpit renders).
 *
 * Pure type module moved out of the old page (`app/flows/[id]/page.tsx`) per
 * the Phase 0 guidance: shared client types live in `types/`, not on a route
 * file.
 */
import type { NodeUiCapabilities } from "@/types/nodeCapabilities";

/** Config keys a plan/artifact meta blob uses in the panels. */
export type ArtifactMeta = Record<string, unknown>;

export type Artifact = {
  id: string;
  kind: string;
  version: number;
  status: string;
  feedback?: string;
  createdAt: string;
  /** the engine's per-kind JSON blob (plan-meta, webhook payload log, …) */
  meta?: ArtifactMeta;
};
export type NodeCost = {
  totalCents: number;
  tokens: number;
  /** the node's raw run rows (the cost chip re-derives its rollup from these) */
  runs: unknown[];
};
/** One model's share of the flow's `usage` rollup (Task 21, use case 8d). */
export type UsageRollupModel = {
  model: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costCents: number;
};
/** The flow's `usage` artifacts summed across runs — the queryable cost fact. */
export type UsageRollup = {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costCents: number;
  /** runs whose cost came from the rate-card estimate, not a billed charge */
  estimatedRuns: number;
  models: UsageRollupModel[];
};
export type Node = {
  id: string;
  nodeKey: string;
  type: string;
  status: string;
  agentId?: string | null;
  /** template display name override; null = the node template's own label */
  label?: string | null;
  /** the node template's own display name (when no instance label is set) */
  templateName?: string | null;
  /** catalog kind (builtin | agent | …) and icon name for the generic panel */
  kind?: string | null;
  icon?: string | null;
  /** effective config snapshot (class defaults ← app settings ← template) */
  config?: Record<string, unknown> | null;
  /** the node's serializable UI capabilities (refine/chat/panel title, §3.2) */
  capabilities?: NodeUiCapabilities | null;
  joinMode?: string | null;
  /** the node's contract input (the run's effective payload) */
  input?: Record<string, unknown> | null;
  /** the node's last published output (variables other nodes reference) */
  output?: Record<string, unknown> | null;
  artifacts: Artifact[];
  cost?: NodeCost;
};
export type BranchRow = {
  id: string;
  flowId: string;
  name: string;
  title?: string;
  status: string;
  mrUrl?: string;
  mrIid?: number;
  order: number;
};
export type PlanStepRow = {
  id: string;
  flowId: string;
  artifactId?: string | null;
  metaId?: string | null;
  position: number;
  title: string;
  detail?: string | null;
  files: string[];
  branch?: string | null;
  status: string;
  origin: string;
  completedBy?: string | null;
  /** plan fan-out: the child flow building this step (parent panel step cards) */
  subFlow?: {
    id: string;
    name: string;
    status: string;
    branch: string | null;
    nodeKey: string | null;
    nodeStatus: string | null;
    parentNodeKey: string | null;
    /** Phase 2 merge-back state (durable step_merges row + stale-base derivation) */
    mergeStatus?: string | null;
    mergeAttempts?: number;
    mergeError?: string | null;
    staleBase?: boolean;
    /** Phase 4 cost/duration rollup — the child flow's own run rows (zeroed when none) */
    costCents?: number;
    tokens?: number;
    durationMs?: number;
    runCount?: number;
  } | null;
};
export type FlowData = {
  id: string;
  name: string;
  status: string;
  mrUrl?: string;
  mrIid?: number;
  mrBranch?: string;
  repoUrl?: string;
  executionMode?: string;
  cost?: { totalCents: number; tokens: number; runCount: number };
  /** Task 21 (use case 8d): the flow's `usage` artifacts rolled up across
   *  runs — null when no run established one */
  usage?: UsageRollup;
  /** epoch ms of the queued auto-resolve start (quiet-period end), or null */
  resolveScheduleAt?: number | null;
  branches?: BranchRow[];
  planSteps?: PlanStepRow[];
  /** inbound hooks feeding this flow's waiting nodes (wait_for webhook); `secret` is masked — use GET /api/hooks/:id/secret to reveal */
  hooks?: { id: string; flowId: string; nodeKey: string | null; secret: string; filter: string | null }[];
  task: {
    key: string;
    summary: string;
    status: string;
    issueType: string;
    priority: string;
    prdText: string;
    figmaUrls: string[];
    externalUrl: string;
  };
  nodes: Node[];
};
