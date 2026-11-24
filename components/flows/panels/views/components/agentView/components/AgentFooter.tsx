'use client';

import { CheckCheck, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FLOW_ACTION } from '@/constants/flow';
import type { Node } from '@/types/flow';
import { CHANGE_REQUEST_ACTION_LABEL } from '../constants/changeRequest';
import type { AgentViewModel } from '../hooks/useAgentView';
import type { ActionPayload } from '../../../../context';

/** Status hint plus the node's fact-driven approval / change-request actions. */
export default function AgentFooter({
  node,
  action,
  model,
}: {
  node: Node;
  action: (a: string, b?: ActionPayload) => void;
  model: AgentViewModel;
}) {
  return (
    <>
      <span className="text-xs text-muted-foreground">{model.statusHint}</span>
      <div className="flex-1" />
      {model.awaitingApproval && (
        <Button onClick={() => action(FLOW_ACTION.APPROVE_NODE, { nodeKey: node.nodeKey })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
      {model.openPrVisible && (
        <Button
          variant="outline"
          onClick={() => action(FLOW_ACTION.CREATE_CHANGE_REQUEST, { nodeKey: node.nodeKey })}
        >
          <GitMerge size={13} />{' '}
          {model.changeRequestExists
            ? CHANGE_REQUEST_ACTION_LABEL.PUSH
            : CHANGE_REQUEST_ACTION_LABEL.OPEN}
        </Button>
      )}
    </>
  );
}
