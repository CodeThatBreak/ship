'use client';
import { useState } from 'react';
import { CheckCheck, Sparkles } from 'lucide-react';
import type { Artifact, PlanStepRow } from '@/types/flow';
import { EmptyHint } from '@/components/shared/EmptyHint';
import { PanelShell, ArtifactLoader, VersionTabs, GenericArtifact } from '../shared';
import type { ArtifactPayload } from '../shared';
import { rendererForKind } from '../artifacts/artifactRenderers';
import { ARTIFACT_KIND } from '../artifacts/constants/artifactKinds';
import { useNodePanel } from '../context';
import FanoutStepList from '../FanoutStepList';
import { FLOW_ACTION, FLOW_STATUS, isFailedStatus } from '@/constants/flow';
import { Button } from '@/components/ui/button';

/**
 * The generic runtime panel for declarative nodes (§8 2C): markdown/JSON
 * output viewer, approval button and run monitoring. The prompt is edited in
 * the chat rail — the composer is prefilled with the rendered prompt for the
 * first run, and later messages are refine turns — so this panel is for
 * monitoring output and approving, not for editing the prompt or starting a run.
 * Plan fan-out (Phase 1D): when the node fanned out, the per-step monitoring
 * surface is shown for declarative parent nodes too.
 */
export default function AgentView() {
  const { flow, node, action } = useNodePanel();
  const cfg = (node.config ?? {}) as { output?: string };
  const outputKind = cfg.output === ARTIFACT_KIND.JSON ? ARTIFACT_KIND.JSON : ARTIFACT_KIND.MARKDOWN;

  const running = node.status === FLOW_STATUS.RUNNING;
  const pending = node.status === FLOW_STATUS.PENDING;
  const awaitingApproval = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const finished = node.status === FLOW_STATUS.DONE || node.status === FLOW_STATUS.APPROVED;
  const failed = isFailedStatus(node.status);
  const mdArts = node.artifacts.filter((a: Artifact) => a.kind === outputKind);
  const latest = mdArts[mdArts.length - 1];
  // rendering is keyed off artifact kind, never the node kind: the output's
  // renderer comes from the registry, and every other kind renders below it
  const OutputRenderer = rendererForKind(outputKind);
  const otherKinds = [
    ...new Set(node.artifacts.filter((a: Artifact) => a.kind !== outputKind).map((a: Artifact) => a.kind)),
  ];
  const [selId, setSelId] = useState<string | null>(null);
  const current = mdArts.find(a => a.id === selId) ?? latest;
  // plan fan-out: show the per-step monitoring surface when the node fanned out
  const fannedOut = (flow.planSteps ?? []).some((s: PlanStepRow) => s.sub_flow != null);

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
        {/* plan fan-out: show the per-step monitoring surface when the node fanned out */}
        {fannedOut && <FanoutStepList flow={flow} node={node} />}
        {/* output — latest artifact version (wraps the artifact loader children) */}
        {current && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Sparkles size={14} /> Output
            </h3>
            {mdArts.length > 1 && <VersionTabs arts={mdArts} sel={current.id} onSel={setSelId} className="mb-3.5" />}
            <ArtifactLoader
              id={current.id}
              render={(loaded: ArtifactPayload) => <OutputRenderer artifact={loaded} />}
            />
          </div>
        )}
        {/* non-output artifacts (diff, plan, …) render below the output, by kind */}
        {otherKinds.map(kind => (
          <div key={kind} className="mt-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Sparkles size={14} /> {kind}
            </h3>
            <GenericArtifact
              node={node}
              kind={kind}
              empty={`No ${kind} artifact yet.`}
              renderer={rendererForKind(kind)}
            />
          </div>
        ))}
        {!current && !running && !failed && (
          <EmptyHint icon={Sparkles}>No output yet.</EmptyHint>
        )}
      </PanelShell>
    </>
  );
}
