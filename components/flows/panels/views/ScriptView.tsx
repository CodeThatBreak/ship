"use client";
import {
  CheckCheck,
  Terminal,
} from "lucide-react";
import { PanelShell, ArtifactLoader } from '../shared';
import { useNodePanel } from '../context';
import { EmptyHint } from "@/components/shared/EmptyHint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Artifact } from "@/types/flow";
import {
  FLOW_ACTION,
  FLOW_STATUS,
  isTerminalFlowStatus,
} from "@/constants/flow";

/** The script panel: script summary + output artifact viewer. */
export function ScriptView() {
  const { flow, node, action } = useNodePanel();
  const cfg = (node.config ?? {}) as { runtime?: string; script?: string; cwd?: string };
  const jsonArts = node.artifacts.filter((a: Artifact) => a.kind === "json");
  const latest = jsonArts[jsonArts.length - 1];
  const pending = node.status === FLOW_STATUS.PENDING;
  const awaiting = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const finished = isTerminalFlowStatus(node.status);

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {awaiting
          ? "The script output is ready — approve it to activate the next steps."
          : finished
            ? "The script completed."
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
    <PanelShell node={node} flow={flow} runningLabel="Running the script…" footer={footer}>
      <Card className="p-3.5 mb-3.5">
        <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
          <Terminal size={12} /> Script {cfg.runtime ? `· ${cfg.runtime}` : ""} {cfg.cwd ? `· cwd: ${cfg.cwd}` : ""}
        </div>
        <ScrollArea className="max-h-[180px]" viewportClassName="[&>div]:m-0">
          <pre className="text-[12px] font-mono whitespace-pre-wrap text-foreground/85 m-0">{cfg.script || "(no script configured)"}</pre>
        </ScrollArea>
      </Card>
      {latest ? (
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Terminal size={14} /> Output
          </h3>
          <ArtifactLoader id={latest.id}
            render={(loaded) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{loaded.content}</pre>} />
        </div>
      ) : (
        node.status !== FLOW_STATUS.RUNNING && <EmptyHint icon={Terminal}>No output yet.</EmptyHint>
      )}
    </PanelShell>
  );
}
