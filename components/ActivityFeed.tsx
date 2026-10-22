"use client";
import { useMemo, useState } from "react";
import {
  Brain, Bot, Radio, Wrench, XCircle, Zap, Rocket, ChevronRight,
  FileText, FilePen, Terminal, Search, Globe, Plug, CircleCheck, CircleX, Scissors,
} from "lucide-react";
import Markdown from "./Markdown";
import { cn } from "../lib/utils";
import { eventGrouper, type FeedEvent, type FeedItem, type RunSection, type ToolCall } from "../lib/groupEvents";

// ── formatting helpers ────────────────────────────────────────────────────────
export function fmtDuration(ms?: number): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTokens(n?: number): string {
  if (n == null || !n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k tok`;
  return `${n} tok`;
}

export function fmtCost(dollars?: number): string {
  if (dollars == null) return "";
  return `$${dollars.toFixed(2)}`;
}

function wordCount(s: string): string {
  const n = s.trim().split(/\s+/).filter(Boolean).length;
  return n.toLocaleString();
}

// ── icons ─────────────────────────────────────────────────────────────────────
const TYPE_ICONS: Record<string, { Icon: any; className: string }> = {
  lifecycle: { Icon: Zap, className: "text-amber" },
  error: { Icon: XCircle, className: "text-red" },
  pipeline: { Icon: Rocket, className: "text-accent" },
};

function toolIcon(name: string): { Icon: any; className: string } {
  const n = name.toLowerCase();
  if (/read|view|cat|open|grep.*file/.test(n)) return { Icon: FileText, className: "text-accent" };
  if (/write|edit|create|patch|apply/.test(n)) return { Icon: FilePen, className: "text-purple" };
  if (/shell|bash|exec|run|terminal|command/.test(n)) return { Icon: Terminal, className: "text-amber" };
  if (/search|grep|find|glob|list/.test(n)) return { Icon: Search, className: "text-accent" };
  if (/web|fetch|http|browse|url/.test(n)) return { Icon: Globe, className: "text-green" };
  if (/mcp/.test(n)) return { Icon: Plug, className: "text-purple" };
  return { Icon: Wrench, className: "text-text-dim" };
}

// ── filter state ──────────────────────────────────────────────────────────────
interface Filters { thinking: boolean; tools: boolean; status: boolean }

export default function ActivityFeed({ events, nodeKeysByNodeId }: { events: FeedEvent[]; nodeKeysByNodeId?: Map<string, string> }) {
  const [filters, setFilters] = useState<Filters>({ thinking: false, tools: true, status: false });
  const sections = useMemo(() => eventGrouper.group(events, nodeKeysByNodeId), [events, nodeKeysByNodeId]);

  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <FilterBar filters={filters} onChange={setFilters} />
      {sections.length === 0 && <p className="text-muted">No activity yet.</p>}
      {[...sections].reverse().map((s) => (
        <RunBlock key={s.key} section={s} filters={filters} />
      ))}
    </div>
  );
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const toggle = (k: keyof Filters) => onChange({ ...filters, [k]: !filters[k] });
  const Chip = ({ k, label }: { k: keyof Filters; label: string }) => (
    <button
      onClick={() => toggle(k)}
      className={cn(
        "px-2 py-0.5 rounded-full text-[10.5px] font-medium border transition-colors",
        filters[k] ? "border-accent/50 text-accent bg-accent-soft" : "border-border bg-panel-2 text-muted hover:text-text-dim"
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1.5 sticky top-0 bg-panel pb-1 z-10">
      <span className="text-muted text-[10.5px] mr-1">Show:</span>
      <Chip k="thinking" label="🧠 Thinking" />
      <Chip k="tools" label="🔧 Tools" />
      <Chip k="status" label="📡 Status" />
    </div>
  );
}

// ── run section ───────────────────────────────────────────────────────────────
function RunBlock({ section, filters }: { section: RunSection; filters: Filters }) {
  const [open, setOpen] = useState(section.active);
  const items = section.items.filter((it) => {
    if (it.kind === "group") {
      if (it.group.kind === "thinking" && !filters.thinking) return false;
      if (it.group.kind === "status" && !filters.status) return false;
    }
    if (it.kind === "tool" && !filters.tools) return false;
    return true;
  });

  const started = section.startedAt ? new Date(section.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const f = section.finished;
  const footer = f
    ? [fmtDuration(f.durationMs), fmtTokens(f.tokens), fmtCost(f.cost) + (f.estimated ? " est." : "")].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="border border-border-soft rounded-[10px] overflow-hidden bg-panel-2/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-panel-2/70 transition-colors"
      >
        <ChevronRight size={13} className={cn("shrink-0 text-muted transition-transform", open && "rotate-90")} />
        <span className="font-medium text-text-dim">{section.label}</span>
        <span className="text-muted text-[10.5px]">
          {started}{section.mode ? ` · ${section.mode}` : ""}{f?.model ? ` · ${f.model}` : ""}
        </span>
        <span className="flex-1" />
        {section.active && <span className="size-1.5 rounded-full bg-accent animate-pulse" />}
        {!open && footer && <span className="text-muted text-[10.5px]">{footer}</span>}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-0.5 grid gap-1.5 border-t border-border-soft/60">
          {items.map((it, i) => <FeedItemRow key={i} item={it} />)}
          {items.length === 0 && <p className="text-muted text-[11px] italic">(all entries hidden by filters)</p>}
          {footer && <div className="text-muted text-[10.5px] pt-1 border-t border-border-soft/40 mt-0.5">{section.label} finished · {footer}</div>}
        </div>
      )}
    </div>
  );
}

function FeedItemRow({ item }: { item: FeedItem }) {
  if (item.kind === "group") return <GroupCard group={item.group} />;
  if (item.kind === "tool") return <ToolCard tool={item.tool} />;
  const e = item.event;
  const { Icon, className } = TYPE_ICONS[e.type] ?? { Icon: Zap, className: "text-muted" };
  return (
    <div className="flex gap-[9px] items-start">
      <Icon size={14} className={cn("shrink-0 mt-0.5", className)} />
      <div className="min-w-0">
        <span className={cn("whitespace-pre-wrap break-words", e.type === "error" ? "text-red" : "text-text-dim")}>
          {e.message}
        </span>
        <div className="text-muted text-[10.5px] mt-0.5">{new Date(e.created_at).toLocaleTimeString()}</div>
      </div>
    </div>
  );
}

// ── merged thinking/assistant/status groups ───────────────────────────────────
function GroupCard({ group }: { group: { kind: string; text: string; events: FeedEvent[]; lastAt: string } }) {
  const [open, setOpen] = useState(false);
  const meta =
    group.kind === "thinking" ? { Icon: Brain, cls: "text-muted", label: `Thinking (${wordCount(group.text)} words)`, dim: true }
    : group.kind === "assistant" ? { Icon: Bot, cls: "text-purple", label: "Assistant", dim: false }
    : { Icon: Radio, cls: "text-accent", label: "Status", dim: false };
  const merged = group.events.length > 1;
  return (
    <div className={cn(meta.dim && "opacity-60")}>
      <button onClick={() => setOpen((o) => !o)} className="flex gap-[9px] items-center text-left w-full">
        <meta.Icon size={14} className={cn("shrink-0", meta.cls)} />
        <span className={cn("text-[11.5px]", meta.dim ? "text-muted" : "text-text-dim")}>{meta.label}</span>
        {merged && <span className="text-muted text-[10px]">×{group.events.length}</span>}
        <ChevronRight size={11} className={cn("text-muted transition-transform", open && "rotate-90")} />
        <span className="text-muted text-[10.5px] ml-auto">{new Date(group.lastAt).toLocaleTimeString()}</span>
      </button>
      {open && (
        <div className="ml-[23px] mt-1 mb-0.5 text-text-dim">
          {group.kind === "assistant"
            ? <div className="prose-sm"><Markdown text={group.text} /></div>
            : <span className="whitespace-pre-wrap break-words">{group.text}</span>}
        </div>
      )}
    </div>
  );
}

// ── paired tool invocations ───────────────────────────────────────────────────
function summarizeArgs(name: string, args?: string): string {
  if (!args) return "";
  try {
    const a = JSON.parse(args);
    const n = name.toLowerCase();
    const cand = a.path ?? a.file ?? a.file_path ?? a.filename ?? a.command ?? a.cmd ?? a.query ?? a.url ?? a.pattern;
    if (typeof cand === "string") return cand.length > 60 ? cand.slice(0, 57) + "…" : cand;
    const keys = Object.keys(a).slice(0, 3).join(", ");
    return keys.length > 60 ? keys.slice(0, 57) + "…" : keys;
  } catch {
    return args.length > 60 ? args.slice(0, 57) + "…" : args;
  }
}

function ToolCard({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);
  const { Icon, className } = toolIcon(tool.name);
  const done = /complete|finish|success|done/i.test(tool.status);
  const failed = /fail|error/i.test(tool.status);
  const truncated = tool.events.some((e) => { try { return JSON.parse(e.data ?? "{}").truncated; } catch { return false; } });
  const summary = summarizeArgs(tool.name, tool.args);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex gap-[9px] items-center text-left w-full">
        <Icon size={14} className={cn("shrink-0", className)} />
        <span className="font-mono text-[11.5px] text-text-dim">{tool.name}</span>
        {summary && <span className="text-muted text-[11px] truncate max-w-[220px]">{summary}</span>}
        <span className="flex-1" />
        {tool.durationMs != null && <span className="text-muted text-[10.5px]">{fmtDuration(tool.durationMs)}</span>}
        {done && !failed && <CircleCheck size={12} className="text-green shrink-0" />}
        {failed && <CircleX size={12} className="text-red shrink-0" />}
        {truncated && <Scissors size={11} className="text-amber shrink-0" />}
        {!done && !failed && <span className="size-1.5 rounded-full bg-accent animate-pulse shrink-0" />}
        <ChevronRight size={11} className={cn("text-muted transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="ml-[23px] mt-1 mb-0.5 grid gap-1.5">
          {tool.args && (
            <pre className="scroll whitespace-pre-wrap break-all bg-bg-soft border border-border-soft rounded-lg p-2 text-[11px] font-mono text-text-dim max-h-[220px] overflow-auto">{pretty(tool.args)}</pre>
          )}
          {tool.result && (
            <pre className="scroll whitespace-pre-wrap break-all bg-bg-soft border border-border-soft rounded-lg p-2 text-[11px] font-mono text-muted max-h-[220px] overflow-auto">{truncate(tool.result, 4000)}</pre>
          )}
          <div className="text-muted text-[10.5px]">{tool.status} · {new Date(tool.events[tool.events.length - 1].created_at).toLocaleTimeString()}</div>
        </div>
      )}
    </div>
  );
}

function pretty(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n… (${(s.length - n).toLocaleString()} more chars)` : s;
}
