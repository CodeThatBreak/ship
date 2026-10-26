"use client";
import { Pencil } from "lucide-react";
import type { Node } from "@/types/flow";
import { CostChip } from "../panels/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isFailedStatus, statusVariantOf } from "@/constants/flow";

/** Sticky plan panel header: title, status badge, cost chip, edit-prompt action. */
export function PlanPanelHeader({
  node,
  onEditPrompt,
}: {
  node: Node;
  onEditPrompt: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
      <h2 className="m-0 text-[15px]">Implementation plan</h2>
      <Badge
        className={statusVariantOf(node.status)}
        variant={isFailedStatus(node.status) ? "destructive" : undefined}
      >
        <span className="size-1.5 rounded-full bg-current" />
        {node.status.replace(/_/g, " ")}
      </Badge>
      <CostChip node={node} />
      <div className="flex-1" />
      <Button size="xs" variant="secondary" onClick={onEditPrompt}>
        <Pencil size={12} /> Edit prompt
      </Button>
    </div>
  );
}
