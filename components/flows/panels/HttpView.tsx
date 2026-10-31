"use client";
import { CheckCheck, Globe, Send } from "lucide-react";
import { PanelShell, ArtifactLoader } from "./shared";
import { useNodePanel } from "./context";
import { EmptyHint } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Artifact } from "@/types/flow";
import {
  FLOW_ACTION,
  FLOW_STATUS,
  isTerminalFlowStatus,
} from "@/constants/flow";

/** The http panel: URL/method summary + response artifact viewer. */
export function HttpView() {
  const { flow, node, action } = useNodePanel();
  const cfg = (node.config ?? {}) as { url?: string; method?: string };
  const jsonArts = node.artifacts.filter((a: Artifact) => a.kind === "json");
  const latest = jsonArts[jsonArts.length - 1];
  const pending = node.status === FLOW_STATUS.PENDING;
  const awaiting = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const finished = isTerminalFlowStatus(node.status);

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {awaiting
          ? "The response is ready — approve it to activate the next steps."
          : finished
            ? "The call completed."
            : pending
              ? "Runs automatically when upstream steps finish."
              : ""}
      </span>
      <div className="flex-1" />
      {awaiting && (
        <Button onClick={() => action(FLOW_ACTION.APPROVE_NODE, { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} flow={flow} runningLabel="Issuing the request…" footer={footer}>
      <Card className="p-3.5 mb-3.5">
        <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
          <Globe size={12} /> Request
        </div>
        <p className="text-[12.5px] font-mono text-foreground/85 m-0 break-all">
          <Badge className="mr-2">{cfg.method ?? "GET"}</Badge>{cfg.url || "(no URL configured)"}
        </p>
      </Card>
      {latest ? (
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Send size={14} /> Response
          </h3>
          <ArtifactLoader id={latest.id}
            render={(loaded) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{loaded.content}</pre>} />
        </div>
      ) : (
        node.status !== FLOW_STATUS.RUNNING && <EmptyHint icon={Send}>No response yet.</EmptyHint>
      )}
    </PanelShell>
  );
}
