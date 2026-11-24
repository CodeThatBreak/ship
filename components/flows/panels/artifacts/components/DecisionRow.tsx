"use client";
import { Badge } from "@/components/ui/badge";
import { RESOLVE_ACTION_VARIANT } from "../constants/resolveCommentActions";
import type { ResolveDecisionView } from "../utils/resolvePayload";

/** One resolved-comment decision row in the resolve ledger. */
export const DecisionRow = ({ decision }: { decision: ResolveDecisionView }) => (
  <div className="flex gap-2 items-baseline text-[13px] flex-wrap">
    <span className="font-mono text-[11px] text-muted-foreground">{decision.id}</span>
    <Badge className={RESOLVE_ACTION_VARIANT[decision.action] ?? ""}>{decision.action}</Badge>
    {!decision.resolve && <Badge>thread stays open</Badge>}
    {decision.reply && <span className="min-w-0 flex-1 text-muted-foreground">“{decision.reply}”</span>}
    {decision.note && <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">{decision.note}</span>}
  </div>
);
