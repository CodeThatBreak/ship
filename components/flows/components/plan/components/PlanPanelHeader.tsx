'use client';
import type { Node } from '@/types/flow';
import { Badge } from '@/components/ui/badge';
import { isFailedStatus, statusVariantOf } from '@/constants/flow';

/**
 * Sticky plan panel header: title and status badge. Usage lives in its own
 * tab, keeping the header focused on plan state. Before the first plan, the
 * composer is the plan input and starts focused (docs/plan-conversation-refine.md §4b).
 */
export function PlanPanelHeader({ node }: { node: Node }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
      <h2 className="m-0 text-[15px]">Implementation plan</h2>
      <Badge className={statusVariantOf(node.status)} variant={isFailedStatus(node.status) ? 'destructive' : undefined}>
        <span className="size-1.5 rounded-full bg-current" />
        {node.status.replace(/_/g, ' ')}
      </Badge>
    </div>
  );
}
