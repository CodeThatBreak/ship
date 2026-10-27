"use client";
import { PanelShell } from "./shared";
import { registerPanel } from "./registry";
import type { PanelProps } from "./registry";
import { DecisionView } from "./DecisionView";
import { HttpView } from "./HttpView";
import { ScriptView } from "./ScriptView";

/**
 * Phase 3 runtime panels for the declarative kinds (§8): the kind switch
 * stays here — the entry point registered with the panel registry (§3.1) —
 * while the views themselves live in `components/flows/panels/`: decision-view
 * (the decision card, §4.3 — chosen branch + rationale, never buried in run
 * logs), http-view (URL/method summary + response artifact viewer), and
 * script-view (script summary + output artifact viewer).
 */
export default function DeclarativeView(props: PanelProps) {
  switch (props.node.kind) {
    case "decision": return <DecisionView {...props} />;
    case "http": return <HttpView {...props} />;
    case "script": return <ScriptView {...props} />;
    default:
      return (
        <PanelShell node={props.node} action={props.action} flow={props.flow}>
          <p className="text-muted-foreground text-[13px] m-0">No panel for the <strong>{props.node.kind}</strong> node kind.</p>
        </PanelShell>
      );
  }
}

// registered with the panel registry (§3.1) — served by the declarative kinds
registerPanel({ kind: ["decision", "http", "script"] }, DeclarativeView);
