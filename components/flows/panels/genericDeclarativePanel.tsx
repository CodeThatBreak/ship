"use client";
import { useState } from "react";
import { CheckCheck, Play, Settings2, Sparkles } from "lucide-react";
import type { Artifact } from "@/types/flow";
import { EmptyHint } from "@/components/shared/EmptyHint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FLOW_ACTION, FLOW_STATUS } from "@/constants/flow";
import { useNodePanel } from "./context";
import { GenericArtifact, PanelShell, panelTitle } from "./shared";
import { rendererForKind } from "./artifacts/artifactRenderers";
import { ConfigureNodeDialog } from "./ConfigureNodeDialog";

/** Only scalar snapshot values make a readable config summary. */
const CONFIG_SUMMARY_VALUE_TYPES = ["string", "number", "boolean"] as const;

/**
 * The default panel for any declarative node: the node contract's capabilities
 * (the shell resolves `panelTitle`/status), the config snapshot, and artifacts
 * grouped by kind through the renderer registry — never the node's kind/type.
 * Built-in panels stay as overrides in the factory; this is the fallback so an
 * unknown declarative kind still has a working panel. Task 05: a not-yet-run
 * node (`pending`) or a failed one can be reconfigured in-flow — the Configure
 * dialog edits this flow's snapshot and the next run picks the edit up.
 */
export const GenericDeclarativePanel = () => {
  const { flow, node, action, model } = useNodePanel();
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const [configuring, setConfiguring] = useState(false);
  // one group per artifact kind present on the node; the registry decides how
  // each is rendered, so a new artifact kind needs no edit here
  const kinds = [...new Set(node.artifacts.map((a: Artifact) => a.kind))];
  const configRows = Object.entries(cfg).filter(
    ([key, value]) => key !== "prompt"
      && (CONFIG_SUMMARY_VALUE_TYPES as readonly string[]).includes(typeof value),
  );

  const awaitingApproval = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const pending = node.status === FLOW_STATUS.PENDING;
  const running = node.status === FLOW_STATUS.RUNNING;
  const failed = node.status === FLOW_STATUS.FAILED;
  // the engine only reconfigures not-yet-started work (pending) and failed
  // runs (fix the knobs, then retry) — everything else gets no affordance
  const reconfigurable = pending || failed;

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {awaitingApproval
          ? "Output is ready — approve it to activate the next steps."
          : pending
            ? "Run this node to produce its output."
            : failed
              ? "The run failed — fix the config if needed, then retry."
              : ""}
      </span>
      <div className="flex-1" />
      {reconfigurable && (
        <Button variant="outline" onClick={() => setConfiguring(true)}>
          <Settings2 size={13} /> Configure
        </Button>
      )}
      {awaitingApproval && (
        <Button onClick={() => action(FLOW_ACTION.APPROVE_NODE, { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
      {pending && !running && (
        <Button onClick={() => action(FLOW_ACTION.RUN_NODE, { nodeKey: node.node_key, model: model || undefined })}>
          <Play size={13} /> Run
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} flow={flow} runningLabel={`${panelTitle(node)} is running…`} footer={footer}>
      {typeof cfg.prompt === "string" && cfg.prompt && (
        <Card className="p-3.5 mb-3.5">
          <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
            <Sparkles size={12} /> Prompt
          </div>
          <p className="text-[12.5px] whitespace-pre-wrap text-foreground/85 m-0">{cfg.prompt}</p>
        </Card>
      )}
      {configRows.length > 0 && (
        <Card className="p-3.5 mb-3.5">
          <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
            <Sparkles size={12} /> Configuration
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 m-0 text-[12.5px]">
            {configRows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-muted-foreground m-0">{key}</dt>
                <dd className="font-mono text-foreground/85 m-0 break-all">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      {kinds.map((kind) => (
        <div key={kind} className="mb-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Sparkles size={14} /> {kind}
          </h3>
          <GenericArtifact
            node={node}
            kind={kind}
            empty={`No ${kind} artifact yet.`}
            renderer={rendererForKind(kind)}
          />
        </div>
      ))}
      {!kinds.length && !running && (
        <EmptyHint icon={Sparkles}>No output yet.</EmptyHint>
      )}
      {configuring && (
        <ConfigureNodeDialog flowId={flow.id} node={node} onClose={() => setConfiguring(false)} />
      )}
    </PanelShell>
  );
};