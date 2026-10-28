/** Shared plan-domain types for the plan panel and its subcomponents. */

/**
 * Flow-level action callback panels receive (narrowed from
 * panels/registry `PanelProps`, which allows any payload).
 */
export type FlowAction = (a: string, b?: Record<string, unknown>) => void;

/** A branch sub-plan row in `node.output.branches` (plan fan-out, Phase 3A). */
export interface BranchPlan {
  name: string;
  title?: string;
  markdown?: string;
  scope?: string;
  dependsOn?: string[];
  subPlan?: { prompt?: string; steps?: unknown[] } | null;
}

