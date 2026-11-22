'use client';

import { useState } from 'react';
import type { Artifact, FlowData, Node, PlanStepRow } from '@/types/flow';
import { FLOW_STATUS, isFailedStatus } from '@/constants/flow';
import { ARTIFACT_KIND } from '../../../artifacts/constants/artifactKinds';
import { isPanelVerbEligible } from '../../../utils/panelVerbCapability';
import { AGENT_VIEW_TAB } from '../constants/agentViewConstants';
import { hasChangeRequest } from '../utils/changeRequest';
import { footerHintFor } from '../utils/footerHint';

/** All derived state behind the agent panel's shell, footer and tabs. */
export interface AgentViewModel {
  outputKind: string;
  outputArts: Artifact[];
  current: Artifact | undefined;
  onSelectOutput: (id: string) => void;
  otherKinds: string[];
  fannedOut: boolean;
  tabValues: string[];
  hasTabs: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  showEmptyOutput: boolean;
  statusHint: string;
  awaitingApproval: boolean;
  openPrVisible: boolean;
  changeRequestExists: boolean;
}

/**
 * The agent panel's stateful logic: which output is selected, which tab is
 * active, and the fact-driven affordances. Rendering stays in the presentational
 * children so the panel is only a container (§2.2).
 */
export function useAgentView(flow: FlowData, node: Node): AgentViewModel {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const outputKind = cfg.output === ARTIFACT_KIND.JSON ? ARTIFACT_KIND.JSON : ARTIFACT_KIND.MARKDOWN;
  const outputArts = node.artifacts.filter((a: Artifact) => a.kind === outputKind);
  const otherKinds = [
    ...new Set(node.artifacts.filter((a: Artifact) => a.kind !== outputKind).map((a: Artifact) => a.kind)),
  ];
  // plan fan-out: the per-step monitoring surface becomes its own tab when the
  // node fanned out (it used to sit above the artifacts)
  const fannedOut = (flow.planSteps ?? []).some((s: PlanStepRow) => s.sub_flow != null);

  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(AGENT_VIEW_TAB.OUTPUT);
  const current = outputArts.find(a => a.id === selId) ?? outputArts[outputArts.length - 1];
  const tabValues: string[] = [
    AGENT_VIEW_TAB.OUTPUT,
    ...(fannedOut ? [AGENT_VIEW_TAB.STEPS] : []),
    ...otherKinds,
  ];
  // an artifact kind (or the fan-out) can disappear between renders (e.g. a
  // refine reset): fall back to the output tab rather than leaving a stale,
  // hidden panel selected
  const activeTab = tabValues.includes(tab) ? tab : AGENT_VIEW_TAB.OUTPUT;

  const branches = flow.branches ?? [];
  return {
    outputKind,
    outputArts,
    current,
    onSelectOutput: setSelId,
    otherKinds,
    fannedOut,
    tabValues,
    hasTabs: fannedOut || node.artifacts.length > 0,
    activeTab,
    onTabChange: setTab,
    // a live run or a failure owns its own surface — no "No output yet" hint
    showEmptyOutput: node.status !== FLOW_STATUS.RUNNING && !isFailedStatus(node.status),
    statusHint: footerHintFor(node.status),
    awaitingApproval: node.status === FLOW_STATUS.AWAITING_APPROVAL,
    // the direct `create_change_request` affordance is fact-driven: a branch
    // fact must exist for the verb to target and the node must sit in a
    // terminal the engine's `panelVerb` fence accepts. An approval-held node
    // uses its Approve button, which runs the same verb.
    openPrVisible: branches.length > 0 && isPanelVerbEligible(node.status),
    changeRequestExists: hasChangeRequest(flow, branches),
  };
}
