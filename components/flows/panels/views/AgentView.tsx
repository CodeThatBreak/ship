'use client';
import { useState } from 'react';
import { CheckCheck, GitMerge, Sparkles } from 'lucide-react';
import type { Artifact, PlanStepRow } from '@/types/flow';
import { EmptyHint } from '@/components/shared/EmptyHint';
import { PanelShell, ArtifactLoader, VersionTabs, GenericArtifact } from '../shared';
import type { ArtifactPayload } from '../shared';
import { rendererForKind } from '../artifacts/artifactRenderers';
import { ARTIFACT_KIND } from '../artifacts/constants/artifactKinds';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNodePanel } from '../context';
import FanoutStepList from '../FanoutStepList';
import { FLOW_ACTION, FLOW_STATUS, isFailedStatus } from '@/constants/flow';
import { isPanelVerbEligible } from '../utils/panelVerbCapability';
import { Button } from '@/components/ui/button';

const OUTPUT_TAB = 'output';
const STEPS_TAB = 'steps';
/** full-width, edge-to-edge line tabs: each tab shares the strip evenly and
 *  its active underline spans the whole tab (the strip has no inset padding) */
const TRIGGER_CLASS =
  'min-w-0 flex-1 truncate rounded-none border-b-2 border-b-transparent px-3 py-2 text-[12.5px] font-medium after:hidden data-active:border-b-foreground data-active:text-foreground';

/** Tab label for an artifact-backed tab (e.g. `failed_output` → "Failed output"). */
const kindTabLabel = (kind: string): string =>
  kind.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());

/**
 * The generic runtime panel for declarative nodes (§8 2C): markdown/JSON
 * output viewer, approval button and run monitoring. The prompt is edited in
 * the chat rail — the composer is prefilled with the rendered prompt for the
 * first run, and later messages are refine turns — so this panel is for
 * monitoring output and approving, not for editing the prompt or starting a run.
 * Plan fan-out (Phase 1D): when the node fanned out, the per-step monitoring
 * surface is shown for declarative parent nodes too.
 *
 * One line-variant tab strip holds everything the node has to show: the output
 * (the default tab), a Steps tab when the node fanned out, and one tab per
 * other artifact kind the node actually carries — no vertical stacking.
 */
export default function AgentView() {
  const { flow, node, action } = useNodePanel();
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const outputKind = cfg.output === ARTIFACT_KIND.JSON ? ARTIFACT_KIND.JSON : ARTIFACT_KIND.MARKDOWN;

  const running = node.status === FLOW_STATUS.RUNNING;
  const pending = node.status === FLOW_STATUS.PENDING;
  const awaitingApproval = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const finished = node.status === FLOW_STATUS.DONE || node.status === FLOW_STATUS.APPROVED;
  const failed = isFailedStatus(node.status);
  // "Open PR" (task 12, use case 4): the direct `create_change_request`
  // affordance is fact-driven — a branch fact must exist for the verb to
  // target (the verb's own contract is the capability, and it fails loudly
  // without one) and the node must sit in a terminal the engine's
  // `panelVerb` fence accepts (an approval-held node uses its Approve
  // button, which runs the same verb). The `effects` declaration gates only
  // the AUTOMATIC after-approval dispatch, not this manual button.
  const branches = flow.branches ?? [];
  const openPrVisible = branches.length > 0 && isPanelVerbEligible(node.status);
  const mdArts = node.artifacts.filter((a: Artifact) => a.kind === outputKind);
  const latest = mdArts[mdArts.length - 1];
  // rendering is keyed off artifact kind, never the node kind: the output's
  // renderer comes from the registry, every other kind gets its own tab
  const OutputRenderer = rendererForKind(outputKind);
  const otherKinds = [
    ...new Set(node.artifacts.filter((a: Artifact) => a.kind !== outputKind).map((a: Artifact) => a.kind)),
  ];
  // plan fan-out: the per-step monitoring surface becomes its own tab when the
  // node fanned out (it used to sit above the artifacts)
  const fannedOut = (flow.planSteps ?? []).some((s: PlanStepRow) => s.sub_flow != null);
  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(OUTPUT_TAB);
  const current = mdArts.find(a => a.id === selId) ?? latest;
  const tabValues = [OUTPUT_TAB, ...(fannedOut ? [STEPS_TAB] : []), ...otherKinds];
  // an artifact kind (or the fan-out) can disappear between renders (e.g. a
  // refine reset): fall back to the output tab rather than leaving a stale,
  // hidden panel selected
  const activeTab = tabValues.includes(tab) ? tab : OUTPUT_TAB;
  const emptyOutput = !running && !failed ? <EmptyHint icon={Sparkles}>No output yet.</EmptyHint> : null;
  const hasTabs = fannedOut || node.artifacts.length > 0;

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {awaitingApproval
          ? 'Output is ready — approve it to activate the next steps.'
          : finished
            ? 'Output ready. Continue in the chat to refine it.'
            : pending
              ? 'Review the prompt in the chat, then send to run.'
              : failed
                ? 'The run failed — retry it once the issue is fixed.'
                : ''}
      </span>
      <div className="flex-1" />
      {awaitingApproval && (
        <Button onClick={() => action(FLOW_ACTION.APPROVE_NODE, { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
      {openPrVisible && (
        <Button
          variant="outline"
          onClick={() => action(FLOW_ACTION.CREATE_CHANGE_REQUEST, { nodeKey: node.node_key })}
        >
          <GitMerge size={13} /> Open PR
        </Button>
      )}
    </>
  );

  return (
    <>
      <PanelShell
        node={node}
        flow={flow}
        runningLabel={`${node.label || node.template_name || node.node_key} is running…`}
        footer={footer}
      >
        {hasTabs ? (
          <Tabs value={activeTab} onValueChange={setTab} className="gap-0">
            {tabValues.length > 1 && (
              <TabsList
                variant="line"
                aria-label="Agent views"
                className="-mx-5 -mt-4 h-auto w-full rounded-none border-b border-border bg-transparent p-0"
              >
                <TabsTrigger value={OUTPUT_TAB} className={TRIGGER_CLASS}>Output</TabsTrigger>
                {fannedOut && (
                  <TabsTrigger value={STEPS_TAB} className={TRIGGER_CLASS}>Steps</TabsTrigger>
                )}
                {otherKinds.map(kind => (
                  <TabsTrigger key={kind} value={kind} className={TRIGGER_CLASS}>
                    {kindTabLabel(kind)}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            {/* plan fan-out: the per-step monitoring surface is one of the tabs */}
            {fannedOut && (
              <TabsContent value={STEPS_TAB} className="pt-4">
                <FanoutStepList flow={flow} node={node} />
              </TabsContent>
            )}
            <TabsContent value={OUTPUT_TAB} className="pt-4">
              {current ? (
                <div>
                  {mdArts.length > 1 && <VersionTabs arts={mdArts} sel={current.id} onSel={setSelId} className="mb-3.5" />}
                  <ArtifactLoader
                    id={current.id}
                    render={(loaded: ArtifactPayload) => <OutputRenderer artifact={loaded} />}
                  />
                </div>
              ) : (
                emptyOutput
              )}
            </TabsContent>
            {otherKinds.map(kind => (
              <TabsContent key={kind} value={kind} className="pt-4">
                <GenericArtifact
                  node={node}
                  kind={kind}
                  empty={`No ${kindTabLabel(kind)} artifact yet.`}
                  renderer={rendererForKind(kind)}
                  action={action}
                />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          emptyOutput
        )}
      </PanelShell>
    </>
  );
}
