'use client';
import { MessageSquareQuoteIcon } from 'lucide-react';
import type { Node } from '@/types/flow';
import { CostChip } from '../../panels/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isFailedStatus, statusVariantOf } from '@/constants/flow';

/**
 * Sticky plan panel header: title, status badge, cost chip and the refine
 * action — it focuses the chat composer (docs/plan-conversation-refine.md
 * §4b; before the first plan the composer IS the plan input and starts focused).
 */
export function PlanPanelHeader({
  node,
  onRefine,
}: {
  node: Node;
  /** focus the chat composer (container wires this to the plan composer bus) */
  onRefine: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
      <h2 className="m-0 text-[15px]">Implementation plan</h2>
      <Badge className={statusVariantOf(node.status)} variant={isFailedStatus(node.status) ? 'destructive' : undefined}>
        <span className="size-1.5 rounded-full bg-current" />
        {node.status.replace(/_/g, ' ')}
      </Badge>
      <CostChip node={node} />
      <div className="flex-1" />
      <Button
        size="xs"
        variant="secondary"
        onClick={onRefine}
        title="Focus the plan conversation — refine the plan in the chat composer"
      >
        <MessageSquareQuoteIcon size={12} /> Refine plan
      </Button>
    </div>
  );
}
