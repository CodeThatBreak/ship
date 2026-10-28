"use client";
import { useArtifactFetcher } from "@/hooks/use-artifact-fetcher";
import { PanelShell } from "./shared";
import { resolvePanel, type PanelProps } from ".";

/**
 * The node panel dispatcher (§3.1): the registry resolves the panel from the
 * node's def key / declarative kind — no node-key switches here. Every panel
 * receives the same props (the registry's PanelProps); the artifact fetcher is
 * supplied here (through the query cache) so panels stay transport-free.
 */
export default function NodePanel({
  flow, node, action, events = [], model, planOptions = { decompose: false },
}: { flow: PanelProps["flow"]; node: PanelProps["node"]; action: PanelProps["action"]; events?: PanelProps["events"]; model: string; planOptions?: PanelProps["planOptions"] }) {
  const fetchArtifact = useArtifactFetcher();
  const Panel = resolvePanel(node);
  if (Panel) {
    return <Panel flow={flow} node={node} action={action} events={events} model={model} planOptions={planOptions} fetchArtifact={fetchArtifact} />;
  }
  return (
    <PanelShell node={node} action={action} flow={flow}>
      {node.kind
        ? <p className="text-muted-foreground text-[13px] m-0">The <strong>{node.kind}</strong> node type isn&apos;t supported yet — it can&apos;t run, even though you can configure it in the template editor.</p>
        : <p className="text-muted-foreground">No panel for this node.</p>}
    </PanelShell>
  );
}
