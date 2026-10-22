"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Frame, GitMerge, MessageSquare, Activity, Cloud, FolderGit2, Coins } from "lucide-react";
import WorkflowGraph from "../../../components/WorkflowGraph";
import NodePanel from "../../../components/NodePanel";
import ActivityFeed from "../../../components/ActivityFeed";
import ChatPanel from "../../../components/ChatPanel";
import { Badge, BadgeDot } from "../../../components/ui/badge";
import { Spinner } from "../../../components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";

export type Artifact = { id: string; kind: string; version: number; status: string; feedback?: string; created_at: string; meta?: any };
export type NodeCost = { totalCents: number; tokens: number; runs: any[] };
export type Node = {
  id: string; node_key: string; type: string; status: string;
  input?: any; output?: any; artifacts: Artifact[]; cost?: NodeCost;
};
export type BranchRow = {
  id: string; flow_id: string; name: string; title?: string; status: string;
  mr_url?: string; mr_iid?: number; order: number;
};
export type PlanStepRow = {
  id: string; flow_id: string; artifact_id?: string | null; meta_id?: string | null;
  position: number; title: string; detail?: string | null; files: string[];
  branch?: string | null; status: string; origin: string; completed_by?: string | null;
};
export type FlowData = {
  id: string; name: string; status: string; current_node?: string;
  mr_url?: string; mr_iid?: number; mr_branch?: string; repo_url?: string; execution_mode?: string;
  cost?: { totalCents: number; tokens: number; runCount: number };
  branches?: BranchRow[];
  planSteps?: PlanStepRow[];
  ticket: { key: string; summary: string; status: string; issueType: string; priority: string; prdText: string; figmaUrls: string[]; jiraUrl: string };
  nodes: Node[];
};

export default function FlowScreen() {
  const { id } = useParams<{ id: string }>();
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [selected, setSelected] = useState<string>("plan");
  const [events, setEvents] = useState<any[]>([]);
  const lastEventId = useRef("");
  // once the user clicks a node we stop auto-following current_node, so polling
  // doesn't yank the view back to whatever happens to be running
  const userSelected = useRef(false);

  const loadFlow = useCallback(async () => {
    const res = await fetch(`/api/flows/${id}`);
    if (res.ok) {
      const data = await res.json();
      setFlow(data);
      // only adopt the running node as the selection until the user picks one
      setSelected((s) => (!userSelected.current && data.current_node ? data.current_node : s));
    }
  }, [id]);

  const pollEvents = useCallback(async () => {
    const res = await fetch(`/api/flows/${id}/events?after=${encodeURIComponent(lastEventId.current)}`);
    if (res.ok) {
      const { events: ev } = await res.json();
      if (ev.length) {
        setEvents((prev) => [...prev, ...ev].slice(-500));
        lastEventId.current = ev[ev.length - 1].id;
        loadFlow();
      }
    }
  }, [id, loadFlow]);

  useEffect(() => {
    loadFlow();
    pollEvents();
    const t = setInterval(pollEvents, 3000);
    return () => clearInterval(t);
  }, [loadFlow, pollEvents]);

  const action = useCallback(async (act: string, body: any = {}) => {
    await fetch(`/api/flows/${id}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act, ...body }),
    });
    loadFlow();
  }, [id, loadFlow]);

  const node = useMemo(
    () => flow?.nodes.find((n) => n.node_key === selected) ?? flow?.nodes[0],
    [flow, selected]
  );

  const nodeKeysByNodeId = useMemo(
    () => new Map((flow?.nodes ?? []).map((n) => [n.id, n.node_key])),
    [flow]
  );

  if (!flow) return <main className="p-6"><Spinner /> Loading…</main>;

  // busy for the chat panel = this node's agent is running (not just any node)
  const busy = flow.current_node === (node?.node_key ?? "plan");

  return (
    <main className="flex flex-col h-screen">
      {/* header */}
      <header className="flex items-center gap-2.5 px-5 py-3 border-b border-border-soft bg-panel">
        <a href="/" className="inline-flex items-center gap-1.5 text-muted hover:text-text-dim">
          <ArrowLeft size={15} /> DevFlow
        </a>
        <span className="text-border">|</span>
        <a href={flow.ticket.jiraUrl} target="_blank"><Badge variant="blue">{flow.ticket.key}</Badge></a>
        <strong className="text-sm">{flow.ticket.summary}</strong>
        <Badge variant="amber">{flow.ticket.status}</Badge>
        {flow.execution_mode === "local"
          ? <Badge><FolderGit2 size={11} /> local</Badge>
          : <Badge><Cloud size={11} /> cloud</Badge>}
        {flow.ticket.figmaUrls.length > 0 && (
          <a href={flow.ticket.figmaUrls[0]} target="_blank"><Badge variant="purple"><Frame size={11} /> Figma</Badge></a>
        )}
        <div className="flex-1" />
        {flow.cost && flow.cost.runCount > 0 && (
          <Badge title={`${flow.cost.runCount} run${flow.cost.runCount > 1 ? "s" : ""}${flow.cost.tokens ? ` · ${Math.round(flow.cost.tokens / 1000)}k tokens` : ""}`}>
            <Coins size={11} />
            {flow.cost.totalCents > 0 ? `$${(flow.cost.totalCents / 100).toFixed(2)}` : `${Math.round(flow.cost.tokens / 1000)}k tok`}
          </Badge>
        )}
        {flow.branches && flow.branches.filter((b: BranchRow) => b.mr_url).length > 0 ? (
          <span className="flex gap-1">
            {flow.branches.filter((b: BranchRow) => b.mr_url).map((b: BranchRow) => (
              <a key={b.id} href={b.mr_url} target="_blank">
                <Badge variant="purple"><GitMerge size={11} /> {b.name} !{b.mr_iid}</Badge>
              </a>
            ))}
          </span>
        ) : flow.mr_url ? (
          <a href={flow.mr_url} target="_blank"><Badge variant="purple"><GitMerge size={11} /> MR !{flow.mr_iid}</Badge></a>
        ) : (
          <Badge>no MR yet</Badge>
        )}
        <Badge variant={flow.status === "active" ? "green" : "default"}>
          <BadgeDot />{flow.status}
        </Badge>
      </header>

      {/* workflow graph */}
      <div className="border-b border-border-soft bg-bg-soft px-3 py-2.5 overflow-x-auto">
        <WorkflowGraph nodes={flow.nodes} selected={node?.node_key ?? ""} onSelect={(k) => { userSelected.current = true; setSelected(k); }} currentNode={flow.current_node} />
      </div>

      {/* main split: node panel + right rail */}
      <div className="flex flex-1 min-h-0">
        <section className="flex-[1.6] border-r border-border-soft flex flex-col min-h-0 min-w-0">
          {node && <NodePanel flow={flow} node={node} action={action} events={events} />}
        </section>
        <aside className="flex-1 flex flex-col bg-panel min-w-[340px]">
          <Tabs defaultValue="chat" className="flex flex-col flex-1 min-h-0">
            <TabsList className="px-3.5">
              <TabsTrigger value="chat"><MessageSquare size={13} /> Chat</TabsTrigger>
              <TabsTrigger value="activity"><Activity size={13} /> Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="flex-1 min-h-0 p-3.5 flex flex-col overflow-hidden data-[state=inactive]:hidden">
              <ChatPanel
                flowId={flow.id}
                nodeKey={node?.node_key ?? "plan"}
                busy={busy}
                canRefine={Boolean(node?.artifacts.some((a) => a.kind === "plan"))}
              />
            </TabsContent>
            <TabsContent value="activity" className="flex-1 min-h-0 p-3.5 overflow-hidden data-[state=inactive]:hidden">
              <div className="scroll h-full">
                <ActivityFeed events={events} nodeKeysByNodeId={nodeKeysByNodeId} />
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </main>
  );
}
