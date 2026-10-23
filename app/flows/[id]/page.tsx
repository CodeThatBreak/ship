"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import WorkflowGraph from "../../../components/WorkflowGraph";
import NodePanel from "../../../components/NodePanel";
import ChatPanel from "../../../components/ChatPanel";
import FlowHeader from "../../../components/FlowHeader";
import { Spinner } from "../../../components/ui/spinner";
import { composeModelChoice, type ModelChoice } from "../../../lib/modelSpec";

export type Artifact = { id: string; kind: string; version: number; status: string; feedback?: string; created_at: string; meta?: any };
export type NodeCost = { totalCents: number; tokens: number; runs: any[] };
export type Node = {
  id: string; node_key: string; type: string; status: string; agent_id?: string | null;
  /** template display name override; null = the node template's own label */
  label?: string | null;
  /** the node template's own display name (when no instance label is set) */
  template_name?: string | null;
  /** catalog kind (builtin | agent | …) and icon name for the generic panel */
  kind?: string | null;
  icon?: string | null;
  /** effective config snapshot (class defaults ← app settings ← template) */
  config?: Record<string, unknown> | null;
  join_mode?: string | null;
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
  /** epoch ms of the queued auto-resolve start (quiet-period end), or null */
  resolveScheduleAt?: number | null;
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

  // one model override for this flow's runs — picked in the chat panel's
  // model selector, consumed by every run-start action below
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);
  const model = composeModelChoice(modelChoice);

  // plan generation options — toggled via the icon buttons in the chat panel's
  // prompt box / input row, shared by start_plan and refine runs
  const [planOptions, setPlanOptions] = useState({ decompose: false, complex: false });

  const node = useMemo(
    () => flow?.nodes.find((n) => n.node_key === selected) ?? flow?.nodes[0],
    [flow, selected]
  );

  const hasPlan = Boolean(node?.artifacts.some((a) => a.kind === "plan"));
  // the prompt preview box sits over the chat: plan tab, before any plan exists
  const planPending =
    node?.node_key === "plan" && !hasPlan && node?.status === "pending";

  // start (or restart) the plan run — triggered from the prompt box over the
  // chat or by running an edited prompt in the prompt modal
  const startPlan = useCallback(
    (opts?: { prompt?: string; promptIsBody?: boolean }) => {
      return action("start_plan", {
        prompt: opts?.prompt,
        promptIsBody: opts?.promptIsBody || undefined,
        decompose: planOptions.decompose || undefined,
        complex: planOptions.complex || undefined,
        model: model || undefined,
      });
    },
    [action, planOptions.decompose, planOptions.complex, model]
  );

  const nodeKeysByNodeId = useMemo(
    () => new Map((flow?.nodes ?? []).map((n) => [n.id, n.node_key])),
    [flow]
  );

  // node id → status, for the chat panel to close stale "running" sections
  const nodeStatusByNodeId = useMemo(
    () => new Map((flow?.nodes ?? []).map((n) => [n.id, n.status])),
    [flow]
  );

  if (!flow) return <main className="p-6"><Spinner /> Loading…</main>;

  // busy for the chat panel = this node's agent is running (not just any node)
  const busy = flow.current_node === (node?.node_key ?? "plan");

  return (
    <main className="flex flex-col h-screen">
      {/* header */}
      <FlowHeader flow={flow} />

      {/* workflow graph */}
      <div className="border-b border-border bg-background px-3 py-2.5 overflow-x-auto">
        <WorkflowGraph flowId={flow.id} nodes={flow.nodes} selected={node?.node_key ?? ""} onSelect={(k) => { userSelected.current = true; setSelected(k); }} currentNode={flow.current_node} />
      </div>

      {/* main split: node panel + right rail */}
      <div className="flex flex-1 min-h-0">
        <section className="flex-[1.6] border-r border-border flex flex-col min-h-0 min-w-0">
          {node && <NodePanel flow={flow} node={node} action={action} events={events} model={model} planOptions={planOptions} />}
        </section>
        <aside className="flex-1 flex flex-col bg-card min-w-[340px] p-3.5">
          <ChatPanel
            flowId={flow.id}
            nodeKey={node?.node_key ?? "plan"}
            busy={busy}
            canRefine={Boolean(node?.artifacts.some((a) => a.kind === "plan"))}
            events={events}
            nodeKeysByNodeId={nodeKeysByNodeId}
            nodeStatusByNodeId={nodeStatusByNodeId}
            modelChoice={modelChoice}
            setModelChoice={setModelChoice}
            showPromptBox={planPending}
            planOptions={planOptions}
            setPlanOptions={setPlanOptions}
            onStartPlan={startPlan}
          />
        </aside>
      </div>
    </main>
  );
}
