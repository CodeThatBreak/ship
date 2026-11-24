"use client";
import { CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DecisionChoice } from "../types/decisionChoice";

/** One branch row: the label badge, pick/taken styling, description. */
export function DecisionChoiceCard({
  choice,
  taken,
  picked,
  selectable,
  onPick,
}: {
  choice: DecisionChoice;
  taken: boolean;
  picked: boolean;
  selectable: boolean;
  onPick: (label: string) => void;
}) {
  const inner = (
    <div className="flex items-center gap-2.5">
      <Badge className={taken ? "bg-success/10 text-success" : picked ? "bg-info/10 text-info" : undefined}>
        {choice.label}
      </Badge>
      {choice.description && <span className="text-[12.5px] text-muted-foreground flex-1">{choice.description}</span>}
      {taken && <CheckCheck size={14} className="text-success shrink-0" />}
    </div>
  );

  const cardClass = cn(
    "px-4 py-3 w-full text-left",
    selectable && "cursor-pointer",
    picked && "border-info/60 bg-info/5",
    taken && "border-success/60 bg-success/5",
  );

  if (selectable) {
    return (
      <button
        type="button"
        aria-pressed={picked}
        aria-label={`Select branch ${choice.label}`}
        className={cn(
          "rounded-lg bg-card text-card-foreground shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10 border border-transparent",
          cardClass,
        )}
        onClick={() => onPick(choice.label)}
      >
        {inner}
      </button>
    );
  }

  return <Card className={cardClass}>{inner}</Card>;
}
