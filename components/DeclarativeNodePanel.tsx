"use client";
import { useState } from "react";
import { CheckCheck, Globe, Play, Send, Split, Terminal } from "lucide-react";
import type { FlowData, Node, Artifact } from "../app/flows/[id]/page";
import { PanelShell, ArtifactLoader } from "./panels/shared";
import { registerPanel } from "./panels/registry";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Textarea } from "./ui/textarea";

/**
 * Phase 3 runtime panels for the declarative kinds (§8):
 *
 *  - decision: the decision card (§4.3) — chosen branch + rationale, never
 *    buried in run logs. Manual source: the user picks a branch (choose_node).
 *    Approval trigger with an agent/expression pick: the pick is pre-selected
 *    with its rationale — confirm (approve_node) or override (choose_node).
 *  - http: URL/method summary + response artifact viewer.
 *  - script: script summary + output artifact viewer.
 */

interface PanelProps {
  flow: FlowData;
  node: Node;
  action: (a: string, b?: any) => Promise<void> | void;
  model: string;
  fetchArtifact: (id: string) => Promise<any>;
}

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

// ── decision ─────────────────────────────────────────────────────────────────

interface DecisionChoice { label: string; description?: string }

function DecisionView({ flow, node, action, fetchArtifact }: PanelProps) {
  const cfg = (node.config ?? {}) as { source?: string; question?: string; choices?: DecisionChoice[] };
  const choices = cfg.choices ?? [];
  const out = (node.output ?? {}) as { chosen?: string[]; rationale?: string };
  const proposed = out.chosen ?? [];

  const [sel, setSel] = useState<string[]>(proposed);
  const [rationale, setRationale] = useState("");

  const running = node.status === "running";
  const pending = node.status === "pending";
  const awaiting = node.status === "awaiting_approval";
  const finished = node.status === "done" || node.status === "approved";
  // a pick exists (agent/expression) and is held for confirmation — the card
  // pre-selects it; a manual source holds with no pick (chosen: [])
  const hasProposal = awaiting && proposed.length > 0;

  const toggle = (label: string) =>
    setSel((cur) => (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]));

  const samePick = sel.length === proposed.length && sel.every((l) => proposed.includes(l));

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
    <PanelShell node={node} action={action} flow={flow} runningLabel="Deciding the next branch…" footer={footer}>
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
        {choices.map((c) => {
          const taken = finished && (out.chosen ?? []).includes(c.label);
          const picked = (awaiting ? sel : out.chosen ?? []).includes(c.label);
          const selectable = awaiting;
          return (
            <Card
              key={c.label}
              className={`px-4 py-3 ${selectable ? "cursor-pointer" : ""} ${picked ? "border-info/60 bg-info/5" : ""} ${taken ? "border-success/60 bg-success/5" : ""}`}
              onClick={selectable ? () => toggle(c.label) : undefined}
            >
              <div className="flex items-center gap-2.5">
                <Badge className={taken ? "bg-success/10 text-success" : picked ? "bg-info/10 text-info" : undefined}>
                  {c.label}
                </Badge>
                {c.description && <span className="text-[12.5px] text-muted-foreground flex-1">{c.description}</span>}
                {taken && <CheckCheck size={14} className="text-success shrink-0" />}
              </div>
            </Card>
          );
        })}
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
        <div className="text-center px-5 py-10">
          <Split size={32} className="text-muted-foreground mb-3 mx-auto" />
          <p className="text-muted-foreground max-w-[380px] mx-auto">The decision runs when its upstream steps finish.</p>
        </div>
      )}
    </PanelShell>
  );
}

// ── http ─────────────────────────────────────────────────────────────────────

function HttpView({ flow, node, action, fetchArtifact }: PanelProps) {
  const cfg = (node.config ?? {}) as { url?: string; method?: string };
  const jsonArts = node.artifacts.filter((a: Artifact) => a.kind === "json");
  const latest = jsonArts[jsonArts.length - 1];
  const running = node.status === "running";
  const pending = node.status === "pending";
  const awaiting = node.status === "awaiting_approval";
  const finished = node.status === "done" || node.status === "approved";

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
        <Button onClick={() => action("approve_node", { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} action={action} flow={flow} runningLabel="Issuing the request…" footer={footer}>
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
          <ArtifactLoader id={latest.id} fetchArtifact={fetchArtifact}
            render={(a: any) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{a.content}</pre>} />
        </div>
      ) : (
        !running && (
          <div className="text-center px-5 py-10">
            <Send size={32} className="text-muted-foreground mb-3 mx-auto" />
            <p className="text-muted-foreground max-w-[380px] mx-auto">No response yet.</p>
          </div>
        )
      )}
    </PanelShell>
  );
}

// ── script ───────────────────────────────────────────────────────────────────

function ScriptView({ flow, node, action, fetchArtifact }: PanelProps) {
  const cfg = (node.config ?? {}) as { runtime?: string; script?: string; cwd?: string };
  const jsonArts = node.artifacts.filter((a: Artifact) => a.kind === "json");
  const latest = jsonArts[jsonArts.length - 1];
  const running = node.status === "running";
  const pending = node.status === "pending";
  const awaiting = node.status === "awaiting_approval";
  const finished = node.status === "done" || node.status === "approved";

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
        <Button onClick={() => action("approve_node", { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} action={action} flow={flow} runningLabel="Running the script…" footer={footer}>
      <Card className="p-3.5 mb-3.5">
        <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
          <Terminal size={12} /> Script {cfg.runtime ? `· ${cfg.runtime}` : ""} {cfg.cwd ? `· cwd: ${cfg.cwd}` : ""}
        </div>
        <pre className="text-[12px] font-mono whitespace-pre-wrap text-foreground/85 m-0 max-h-[180px] overflow-y-auto">{cfg.script || "(no script configured)"}</pre>
      </Card>
      {latest ? (
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Terminal size={14} /> Output
          </h3>
          <ArtifactLoader id={latest.id} fetchArtifact={fetchArtifact}
            render={(a: any) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{a.content}</pre>} />
        </div>
      ) : (
        !running && (
          <div className="text-center px-5 py-10">
            <Terminal size={32} className="text-muted-foreground mb-3 mx-auto" />
            <p className="text-muted-foreground max-w-[380px] mx-auto">No output yet.</p>
          </div>
        )
      )}
    </PanelShell>
  );
}

// registered with the panel registry (§3.1) — served by the declarative kinds
registerPanel({ kind: ["decision", "http", "script"] }, DeclarativeView);
