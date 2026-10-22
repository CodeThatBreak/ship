"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, User, Send, Sparkles, Info } from "lucide-react";
import Markdown from "./Markdown";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { Spinner } from "./ui/spinner";
import { Tooltip } from "./ui/tooltip";
import { cn } from "../lib/utils";

type Msg = { id: string; node_key?: string; role: "user" | "assistant"; content: string; created_at: string };

const NODE_LABEL: Record<string, string> = {
  plan: "Plan", build: "Build", pipeline: "Pipeline", review: "Review", resolve: "Resolve",
};

export default function ChatPanel({ flowId, nodeKey, busy, canRefine = true }: { flowId: string; nodeKey: string; busy: boolean; canRefine?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // plan node: does a message regenerate the plan, or just talk to the agent?
  // opt-in only — a plain chat message must never kick off a refinement run
  const [refine, setRefine] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // refinement only makes sense once a plan exists
  const refineAvailable = nodeKey === "plan" && canRefine;
  const refineOn = refineAvailable && refine;

  useEffect(() => {
    const load = () => fetch(`/api/flows/${flowId}/chat`).then((r) => r.json()).then((d) => setMessages(d.messages ?? []));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [flowId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setDraft("");
    await fetch(`/api/flows/${flowId}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeKey, content, chatOnly: nodeKey === "plan" ? !refineOn : false }),
    });
    const d = await fetch(`/api/flows/${flowId}/chat`).then((r) => r.json());
    setMessages(d.messages ?? []);
    setSending(false);
  };

  const nodeMsgs = messages.filter((m) => !m.node_key || m.node_key === nodeKey);
  // show "agent is working" only while this node's agent owes us a chat reply —
  // not for the whole lifetime of an unrelated run
  const last = nodeMsgs[nodeMsgs.length - 1];
  const awaitingReply = sending || (busy && last?.role === "user");

  return (
    <div className="flex flex-col h-full">
      <div className="scroll flex-1 pr-1">
        {nodeMsgs.length === 0 && (
          <div className="text-center px-4 py-8">
            <Sparkles size={24} className="text-purple mb-2.5 mx-auto" />
            <p className="text-muted text-[12.5px] max-w-[260px] mx-auto">
              Chat with the <strong>{NODE_LABEL[nodeKey] ?? nodeKey}</strong> agent. Ask for changes,
              refinements, or explain what to do differently.
            </p>
          </div>
        )}
        {nodeMsgs.map((m) => (
          <div key={m.id} className="flex gap-[9px] mb-3.5">
            <div
              className={cn(
                "size-[26px] rounded-lg shrink-0 flex items-center justify-center",
                m.role === "user" ? "bg-accent-soft text-accent" : "bg-purple-soft text-purple"
              )}
            >
              {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div
              className={cn(
                "md flex-1 min-w-0 max-w-full border px-3 py-[9px] text-[13px]",
                m.role === "user"
                  ? "bg-accent-soft border-accent/30 rounded-[12px_4px_12px_12px]"
                  : "bg-panel-2 border-border-soft rounded-[4px_12px_12px_12px]"
              )}
            >
              {m.role === "assistant" ? <Markdown text={m.content} /> : <span>{m.content}</span>}
              <div className="text-[10.5px] text-muted mt-1.5 uppercase tracking-[0.5px]">
                {m.role === "user" ? "you" : NODE_LABEL[m.node_key ?? ""] ?? "agent"} · {new Date(m.created_at).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        {awaitingReply && (
          <div className="flex gap-[9px] mb-3.5">
            <div className="size-[26px] rounded-lg shrink-0 flex items-center justify-center bg-purple-soft text-purple">
              <Bot size={14} />
            </div>
            <div className="bg-panel-2 border border-border-soft rounded-[4px_12px_12px_12px] px-3 py-[9px] text-[13px]">
              <Spinner /> <span className="text-muted">agent is working…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {nodeKey === "plan" && (
        <div className="flex items-center gap-1.5 pt-2.5">
          <Switch checked={refineOn} onCheckedChange={setRefine} id="refine-mode" disabled={!refineAvailable} />
          <label
            htmlFor="refine-mode"
            className={cn(
              "text-[11.5px] select-none",
              refineAvailable ? "text-text-dim cursor-pointer" : "text-muted cursor-not-allowed"
            )}
          >
            Refine plan
          </label>
          <Tooltip
            side="top"
            content={
              !refineAvailable
                ? "No plan yet — generate one first, then you can refine it from here."
                : refineOn
                  ? "On: your message regenerates the plan with this feedback (a full agent run). Switch off to just ask the agent a question."
                  : "Off: just chat with the plan agent — answers questions without touching the plan. Switch on to regenerate the plan from your message."
            }
          >
            <Info size={13} className="text-muted hover:text-text-dim cursor-help" />
          </Tooltip>
        </div>
      )}
      <div className="flex gap-2 pt-2.5 mt-1 border-t border-border-soft">
        <Textarea
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={
            refineOn
              ? "Refine the plan… e.g. 'use the existing auth middleware' (Enter to send)"
              : `Message the ${NODE_LABEL[nodeKey] ?? nodeKey} agent… (Enter to send)`
          }
          rows={2} className="flex-1 text-[12.5px]"
        />
        <Button variant="primary" onClick={send} disabled={!draft.trim() || sending} className="self-end">
          <Send size={14} />
        </Button>
      </div>
    </div>
  );
}
