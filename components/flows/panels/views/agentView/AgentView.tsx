'use client';

import { PanelShell } from '../../shared';
import { useNodePanel } from '../../context';
import AgentFooter from './components/AgentFooter';
import AgentTabs from './components/AgentTabs';
import { useAgentView } from './hooks/useAgentView';

/**
 * The generic runtime panel for declarative nodes (§8 2C): markdown/JSON
 * output viewer, approval button and run monitoring. The prompt is edited in
 * the chat rail — the composer is prefilled with the rendered prompt for the
 * first run, and later messages are refine turns — so this panel is for
 * monitoring output and approving, not for editing the prompt or starting a run.
 * Plan fan-out (Phase 1D): when the node fanned out, the per-step monitoring
 * surface is shown for declarative parent nodes too.
 *
 * This is only the container: state and derived facts live in `useAgentView`,
 * the shell's footer and tab surface are presentational children.
 */
export default function AgentView() {
  const { flow, node, action } = useNodePanel();
  const model = useAgentView(flow, node);

  return (
    <PanelShell
      node={node}
      flow={flow}
      hideCost
      runningLabel={`${node.label || node.template_name || node.node_key} is running…`}
      footer={<AgentFooter node={node} action={action} model={model} />}
    >
      <AgentTabs flow={flow} node={node} action={action} model={model} />
    </PanelShell>
  );
}
