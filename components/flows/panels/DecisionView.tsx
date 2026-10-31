"use client";
import { useCallback, useMemo, useState } from "react";
import { CheckCheck, Split } from "lucide-react";
import { PanelShell } from "./shared";
import { useNodePanel } from "./context";
import { PanelEmptyState } from "./PanelEmptyState";
import {
  FLOW_STATUS,
  isTerminalFlowStatus,
} from "@/constants/flow";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  effectiveDecisionSelection,
  isSameDecisionPick,
  toggleDecisionLabel,
} from "./utils/decision-selection";

interface DecisionChoice { label: string; description?: string }

/** The decision card (§4.3): chosen branch + rationale, never buried in run
 *  logs. Manual source: the user picks a branch (choose_node). Approval
 *  trigger with an agent/expression pick: the pick is pre-selected with its
 *  rationale — confirm (approve_node) or override (choose_node). */
export function DecisionView() {
  const { flow, node, action } = useNodePanel();
  const cfg = (node.config ?? {}) as { source?: string; question?: string; choices?: DecisionChoice[] };
  const choices = cfg.choices ?? [];
  const out = (node.output ?? {}) as { chosen?: string[]; rationale?: string };
  const proposed = useMemo(() => out.chosen ?? [], [out.chosen]);

  const [override, setOverride] = useState<string[] | null>(null);
  const sel = effectiveDecisionSelection(override, proposed);
  const [rationale, setRationale] = useState("");

  const running = node.status === FLOW_STATUS.RUNNING;
  const pending = node.status === FLOW_STATUS.PENDING;
  const awaiting = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const finished = isTerminalFlowStatus(node.status);
  // a pick exists (agent/expression) and is held for confirmation — the card
  // pre-selects it; a manual source holds with no pick (chosen: [])
  const hasProposal = awaiting && proposed.length > 0;

  const onPickChoice = useCallback(
    (label: string) =>
      setOverride((cur) => toggleDecisionLabel(cur ?? proposed, label)),
    [proposed],
  );

  const samePick = isSameDecisionPick(sel, proposed);

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {awaiting
          ? hasProposal
            ? "The proposed branch is pre-selected — confirm it, or change the pick."
            : "Pick the branch this flow should take."
          : finished
            ? `Took: ${(out.chosen ?? []).join(" + ") || "—"}`
            : pending
              ? "Runs automatically when upstream steps finish."
              : ""}
      </span>
      <div className="flex-1" />
      {awaiting && hasProposal && samePick && (
        <Button onClick={() => action("approve_node", { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Confirm {proposed.join(" + ")}
        </Button>
      )}
      {awaiting && (!hasProposal || !samePick) && (
        <Button disabled={!sel.length} onClick={() => action("choose_node", { nodeKey: node.node_key, chosen: sel, rationale: rationale || undefined })}>
          <Split size={14} /> Take {sel.length ? sel.join(" + ") : "branch"}
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} flow={flow} runningLabel="Deciding the next branch…" footer={footer}>
      {cfg.question && (
        <Card className="p-3.5 mb-3.5">
          <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
            <Split size={12} /> Question {cfg.source ? `· ${cfg.source}` : ""}
          </div>
          <p className="text-[12.5px] whitespace-pre-wrap text-foreground/85 m-0">{cfg.question}</p>
        </Card>
      )}

      {/* the decision card: branches, pick state, rationale — always visible,
          never buried in run logs (§4.3) */}
      <div className="grid gap-2">
        {choices.map((c) => (
          <DecisionChoiceCard
            key={c.label}
            choice={c}
            taken={finished && (out.chosen ?? []).includes(c.label)}
            picked={(awaiting ? sel : out.chosen ?? []).includes(c.label)}
            selectable={awaiting}
            onPick={onPickChoice}
          />
        ))}
      </div>

      {(awaiting || finished) && out.rationale && (
        <Alert className="mt-3.5">
          <span className="flex-1 text-[12.5px]"><strong>Rationale:</strong> {out.rationale}</span>
        </Alert>
      )}
      {awaiting && (
        <div className="mt-3.5">
          <Textarea
            rows={2}
            placeholder="Rationale for the pick (optional — recorded on the node)"
            className="text-[12.5px]"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </div>
      )}
      {!awaiting && !finished && !running && pending && (
        <PanelEmptyState icon={Split}>The decision runs when its upstream steps finish.</PanelEmptyState>
      )}
    </PanelShell>
  );
}

/** One branch row: the label badge, pick/taken styling, description. */
function DecisionChoiceCard({
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
