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
  created_at: string;
  /** the engine's per-kind JSON blob (plan-meta, webhook payload log, …) */
  meta?: ArtifactMeta;
};
export type NodeCost = {
  totalCents: number;
  tokens: number;
  /** the node's raw run rows (the cost chip re-derives its rollup from these) */
  runs: unknown[];
};
export type Node = {
  id: string;
  node_key: string;
  type: string;
  status: string;
  agent_id?: string | null;
  /** template display name override; null = the node template's own label */
  label?: string | null;
  /** the node template's own display name (when no instance label is set) */
  template_name?: string | null;
  /** catalog kind (builtin | agent | …) and icon name for the generic panel */
  kind?: string | null;
  icon?: string | null;
  /** effective config snapshot (class defaults ← app settings ← template) */
  config?: Record<string, unknown> | null;
  /** the node's serializable UI capabilities (refine/chat/panel title, §3.2) */
  capabilities?: NodeUiCapabilities | null;
  join_mode?: string | null;
  /** the node's contract input (the run's effective payload) */
  input?: Record<string, unknown> | null;
  /** the node's last published output (variables other nodes reference) */
  output?: Record<string, unknown> | null;
  artifacts: Artifact[];
  cost?: NodeCost;
};
export type BranchRow = {
  id: string;
  flow_id: string;
  name: string;
  title?: string;
  status: string;
  mr_url?: string;
  mr_iid?: number;
  order: number;
};
export type PlanStepRow = {
  id: string;
  flow_id: string;
  artifact_id?: string | null;
  meta_id?: string | null;
  position: number;
  title: string;
  detail?: string | null;
  files: string[];
  branch?: string | null;
  status: string;
  origin: string;
  completed_by?: string | null;
  /** plan fan-out: the child flow building this step (parent panel step cards) */
  sub_flow?: {
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
  current_node?: string;
  mr_url?: string;
  mr_iid?: number;
  mr_branch?: string;
  repo_url?: string;
  execution_mode?: string;
  cost?: { totalCents: number; tokens: number; runCount: number };
  /** epoch ms of the queued auto-resolve start (quiet-period end), or null */
  resolveScheduleAt?: number | null;
  branches?: BranchRow[];
  planSteps?: PlanStepRow[];
  /** inbound hooks feeding this flow's waiting nodes (wait_for webhook); `secret` is masked — use GET /api/hooks/:id/secret to reveal */
  hooks?: { id: string; flow_id: string; node_key: string | null; secret: string; filter: string | null }[];
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
