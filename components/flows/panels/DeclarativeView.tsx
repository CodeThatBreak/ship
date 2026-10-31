"use client";
import { PanelShell } from "./shared";
import { DecisionView } from "./DecisionView";
import { HttpView } from "./HttpView";
import { ScriptView } from "./ScriptView";
import { useNodePanel } from "./context";
import { NODE_KIND } from "@/constants/node-kind";

/**
 * Phase 3 runtime panels for the declarative kinds (§8): the kind switch
 * stays here — the factory serves this entry for the declarative kinds
 * (`decision` / `http` / `script`) — while the views themselves live in
 * `components/flows/panels/`: decision-view (the decision card, §4.3 — chosen
 * branch + rationale, never buried in run logs), http-view (URL/method
 * summary + response artifact viewer), and script-view (script summary +
 * output artifact viewer).
 */
export default function DeclarativeView() {
  const { flow, node } = useNodePanel();
  switch (node.kind) {
    case NODE_KIND.DECISION: return <DecisionView />;
    case NODE_KIND.HTTP: return <HttpView />;
    case NODE_KIND.SCRIPT: return <ScriptView />;
    default:
      return (
        <PanelShell node={node} flow={flow}>
          <p className="text-muted-foreground text-[13px] m-0">No panel for the <strong>{node.kind}</strong> node kind.</p>
        </PanelShell>
      );
  }
}
