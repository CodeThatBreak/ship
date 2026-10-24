"use client";
import { PanelShell } from "./panels/shared";
import { resolvePanel, type PanelProps } from "./panels";

function fetchArtifact(id: string) {
  return fetch(`/api/artifacts/${id}`).then((r) => r.json());
}

/**
 * The node panel dispatcher (§3.1): the registry resolves the panel from the
 * node's def key / declarative kind — no node-key switches here. Every panel
 * receives the same props (the registry's PanelProps); the fetch helper is
 * supplied here so panels stay transport-free.
 */
export default function NodePanel({
  flow, node, action, events = [], model, planOptions = { decompose: false, complex: false },
}: { flow: PanelProps["flow"]; node: PanelProps["node"]; action: PanelProps["action"]; events?: any[]; model: string; planOptions?: PanelProps["planOptions"] }) {
  const Panel = resolvePanel(node);
  if (Panel) {
    return <Panel flow={flow} node={node} action={action} events={events} model={model} planOptions={planOptions} fetchArtifact={fetchArtifact} />;
  }
  return (
    <PanelShell node={node} action={action} flow={flow}>
      {node.kind
        ? <p className="text-muted-foreground text-[13px] m-0">The <strong>{node.kind}</strong> node kind ships with a later phase — configure it in the template editor, but it cannot run yet.</p>
        : <p className="text-muted-foreground">No panel for this node.</p>}
    </PanelShell>
  );
}
