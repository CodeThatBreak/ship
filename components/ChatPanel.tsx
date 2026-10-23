"use client";

import * as React from "react";
import {
  ArrowUpIcon,
  BotIcon,
  BracesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CompassIcon,
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  LayersIcon,
  LoaderCircleIcon,
  MessageCircleDashedIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";

import { Markdown } from "@/components/markdown";
import PromptModal from "@/components/PromptModal";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import ModelSelector from "@/components/ModelSelector";
import { composeModelChoice, type ModelChoice } from "@/lib/modelSpec";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";
import {
  eventGrouper,
  flowEventNodeKeys,
  type FeedEvent,
  type FeedGroup,
  type FeedItem,
  type RunSection,
  type ToolCall,
} from "../lib/groupEvents";
import {
  fmtCost,
  fmtDuration,
  fmtTokens,
  prettyJson,
  summarizeArgs,
  truncateChars,
} from "../lib/format";

type Msg = {
  id: string;
  node_key?: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

const NODE_LABEL: Record<string, string> = {
  plan: "Plan",
  build: "Build",
  pipeline: "Pipeline",
  review: "Review",
  resolve: "Resolve",
};

// ── tool icons ───────────────────────────────────────────────────────────────
function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  const Icon = /read|view|cat|open|grep.*file/.test(n)
    ? FileTextIcon
    : /write|edit|create|patch|apply/.test(n)
      ? FilePenLineIcon
      : /shell|bash|exec|run|terminal|command/.test(n)
        ? TerminalIcon
        : /search|grep|find|glob|list/.test(n)
          ? SearchIcon
          : /web|fetch|http|browse|url/.test(n)
            ? GlobeIcon
            : WrenchIcon;
  return <Icon />;
}

// ── unified timeline: chat messages interleaved with run sections by time ────
type Row =
  | { kind: "msg"; t: number; msg: Msg }
  | { kind: "run"; t: number; section: RunSection }
  | { kind: "event"; t: number; ev: FeedEvent };

/** Sort key for a run section: while it's running it sits at the time it started
 *  (the block is open/live); a finished section floats to its last event's time,
 *  so chat messages sent mid-run render after (not before) the collapsed block. */
function sectionSortKey(s: RunSection): number {
  const started = Date.parse(s.startedAt ?? sectionLastTime(s));
  if (s.active || !s.items.length) return started;
  return Math.max(started, Date.parse(sectionLastTime(s)));
}

function sectionLastTime(s: RunSection): string {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i];
    if (it.kind === "event") return it.event.created_at;
    if (it.kind === "tool")
      return it.tool.events[it.tool.events.length - 1].created_at;
    if (it.kind === "group") return it.group.lastAt;
  }
  return s.startedAt ?? "";
}

export type PlanOptions = { decompose: boolean; complex: boolean };
export type PlanStartOpts = { prompt?: string; promptIsBody?: boolean };

export default function ChatPanel({
  flowId,
  nodeKey,
  busy,
  canRefine = true,
  events,
  nodeKeysByNodeId,
  nodeStatusByNodeId,
  modelChoice,
  setModelChoice,
  showPromptBox = false,
  planOptions,
  setPlanOptions,
  onStartPlan,
}: {
  flowId: string;
  nodeKey: string;
  busy: boolean;
  canRefine?: boolean;
  events: FeedEvent[];
  nodeKeysByNodeId?: Map<string, string>;
  /** node id → status; used as the authority on whether a run is really running,
   *  since a run's "finished" event can fall outside the fetched event window */
  nodeStatusByNodeId?: Map<string, string>;
  modelChoice: ModelChoice | null;
  setModelChoice: (choice: ModelChoice | null) => void;
  /** plan tab, before any plan exists: show the prompt preview box over the chat */
  showPromptBox?: boolean;
  planOptions?: PlanOptions;
  setPlanOptions?: (opts: PlanOptions) => void;
  onStartPlan?: (opts?: PlanStartOpts) => void | Promise<void>;
}) {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  // plan node: does a message regenerate the plan ("refine"), or just talk?
  // opt-in only — a plain chat message must never kick off a refinement run
  const [refine, setRefine] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  // refinement only makes sense once a plan exists
  const refineAvailable = nodeKey === "plan" && canRefine;
  const refineOn = refineAvailable && refine;

  // before a plan exists there is nothing to chat with yet — the input (and its
  // send button) are locked with a hint until the plan run is generated
  const inputLocked = Boolean(showPromptBox);

  // prompt preview over the chat (plan tab, before a plan exists): the plan
  // prompt is fetched so the box shows a partial preview — click to expand,
  // edit icon moves it into the prompt modal
  const [planPrompt, setPlanPrompt] = React.useState<string | null>(null);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [promptEditing, setPromptEditing] = React.useState(false);

  React.useEffect(() => {
    if (!showPromptBox) return;
    let live = true;
    fetch(`/api/flows/${flowId}/prompt?node=plan`)
      .then((r) => r.json())
      .then((d) => {
        if (live) setPlanPrompt(d?.prompt ?? "");
      })
      .catch(() => {
        if (live) setPlanPrompt("");
      });
    return () => {
      live = false;
    };
  }, [flowId, showPromptBox]);

  React.useEffect(() => {
    const load = () =>
      fetch(`/api/flows/${flowId}/chat`)
        .then((r) => r.json())
        .then((d) => setMessages(d.messages ?? []));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [flowId]);

  const nodeMsgs = messages.filter(
    (m) => !m.node_key || m.node_key === nodeKey,
  );

  // run sections for this node only (chat is scoped by node_key; events by run/node-id).
  // A section whose "finished" event fell outside the fetched event window stays
  // open in the grouper forever — the node's authoritative status (kept current
  // by the engine/reconciler) is the tiebreaker: a closed/spinner-less section
  // must never claim to be running when its node isn't.
  const sections = React.useMemo(
    () =>
      eventGrouper
        .group(events, nodeKeysByNodeId)
        .map((s) => {
          if (!s.active) return s;
          const status = nodeStatusByNodeId?.get(s.nodeId ?? "");
          return status && status !== "running" ? { ...s, active: false } : s;
        })
        .filter((s) => s.nodeKey === nodeKey),
    [events, nodeKeysByNodeId, nodeStatusByNodeId, nodeKey],
  );

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = nodeMsgs.map((m) => ({
      kind: "msg",
      t: Date.parse(m.created_at),
      msg: m,
    }));
    for (const s of sections)
      out.push({ kind: "run", t: sectionSortKey(s), section: s });
    // flow-level events (node_id = null: MR pushes, pipeline results, checklist
    // edits, resolve queueing) are mapped to the node they belong to so each
    // tab only shows activity relevant to it; anything unmatched (infra errors)
    // stays visible everywhere. The boilerplate "flow created" announcement is
    // skipped — the chat feed starts with the user's first message.
    for (const e of events) {
      if (e.node_id != null) continue;
      if (/^flow created\b/i.test(e.message ?? "")) continue;
      const relevantTo = flowEventNodeKeys(e);
      if (relevantTo && !relevantTo.includes(nodeKey)) continue;
      out.push({ kind: "event", t: Date.parse(e.created_at), ev: e });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [nodeMsgs, sections, events, nodeKey]);

  const canSend = draft.trim().length > 0 && !sending && !inputLocked;

  const send = async (content: string) => {
    const body = content.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    await fetch(`/api/flows/${flowId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeKey,
        content: body,
        chatOnly: nodeKey === "plan" ? !refineOn : false,
        model: composeModelChoice(modelChoice) || undefined,
      }),
    });
    const d = await fetch(`/api/flows/${flowId}/chat`).then((r) => r.json());
    setMessages(d.messages ?? []);
    setSending(false);
  };

  // show "agent is working" only while this node's agent owes us a chat reply —
  // not for the whole lifetime of an unrelated run
  const last = nodeMsgs[nodeMsgs.length - 1];
  const awaitingReply = sending || (busy && last?.role === "user");

  const itemCount = rows.length + (awaitingReply ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* panel heading */}
      <div className="shrink-0 flex items-center gap-2 px-1 pb-2.5">
        <MessageCircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="m-0 text-[13.5px] font-semibold leading-none">Chat</h2>
        <span className="truncate text-[11px] text-muted-foreground">
          {NODE_LABEL[nodeKey] ?? nodeKey} agent
        </span>
      </div>

      {showPromptBox && (
        <PlanPromptBox
          prompt={planPrompt}
          open={promptOpen}
          onToggle={() => setPromptOpen((v) => !v)}
          onEdit={() => setPromptEditing(true)}
          onGenerate={() => {
            setPromptOpen(false);
            void onStartPlan?.();
          }}
          generating={busy}
        />
      )}

      <MessageScrollerProvider autoScroll>
        {itemCount === 0 ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircleDashedIcon />
              </EmptyMedia>
              <EmptyTitle>
                Message the {NODE_LABEL[nodeKey] ?? nodeKey} agent
              </EmptyTitle>
              <EmptyDescription>
                Ask for changes, refinements, or explain what to do differently.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <MessageScroller className="min-h-0">
            <MessageScrollerViewport className="scroll-fade-b">
              <MessageScrollerContent
                aria-busy={awaitingReply}
                className="gap-6 px-4 py-4 text-sm"
              >
                {rows.map((row, i) => {
                  const key =
                    row.kind === "msg"
                      ? `m${row.msg.id}`
                      : row.kind === "run"
                        ? // index-qualified: two sections can share a runId key
                          // (an event can re-open a run after it was closed)
                          `r${row.section.key}#${i}`
                        : `e${row.ev.id}`;
                  return (
                    <MessageScrollerItem
                      key={key}
                      messageId={key}
                      scrollAnchor={
                        row.kind === "msg" && row.msg.role === "user"
                      }
                    >
                      {row.kind === "msg" ? (
                        <ChatMessageRow msg={row.msg} />
                      ) : null}
                      {row.kind === "run" ? (
                        <RunSectionRow section={row.section} />
                      ) : null}
                      {row.kind === "event" ? (
                        <FlowEventRow ev={row.ev} />
                      ) : null}
                    </MessageScrollerItem>
                  );
                })}
                {awaitingReply && (
                  <MessageScrollerItem messageId="pending" scrollAnchor>
                    <PendingRow nodeKey={nodeKey} />
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        )}
      </MessageScrollerProvider>

      <form
        ref={formRef}
        className="shrink-0 px-3 pb-4 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSend) return;
          void send(draft);
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              inputLocked
                ? "Generate a plan first to interact with the agent"
                : refineOn
                  ? "Refine the plan… e.g. 'use the existing auth middleware'"
                  : `Message the ${NODE_LABEL[nodeKey] ?? nodeKey} agent…`
            }
            aria-label="Message"
            disabled={sending || inputLocked}
            className={cn(
              "min-h-16 p-3",
              inputLocked && "cursor-not-allowed opacity-70",
            )}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <ModelSelector value={modelChoice} onChange={setModelChoice} />
            {nodeKey === "plan" && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      size="icon-xs"
                      variant="outline"
                      aria-pressed={refineOn}
                      aria-label={
                        refineOn ? "Mode: refine plan" : "Mode: chat only"
                      }
                      disabled={!refineAvailable}
                      title={
                        refineAvailable
                          ? refineOn
                            ? "Refine plan — your message regenerates the plan; click to switch to chat only"
                            : "Chat only — just talk without touching the plan; click to switch to refine plan"
                          : "No plan yet — generate one first"
                      }
                      onClick={() => setRefine(!refineOn)}
                      className={cn(
                        !refineAvailable && "opacity-45",
                        refineAvailable &&
                          refineOn &&
                          "border-blue-500/40 bg-blue-500/10 text-blue-400",
                      )}
                    />
                  }
                >
                  {refineOn ? (
                    <PencilIcon className="size-3" />
                  ) : (
                    <WrenchIcon className="size-3" />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {refineOn
                    ? "Refine plan: your message regenerates the plan with this feedback — click to switch to chat only"
                    : refineAvailable
                      ? "Chat only: message the agent without touching the plan — click to enable refine mode"
                      : "No plan yet — generate one first"}
                </TooltipContent>
              </Tooltip>
            )}
            {showPromptBox && planOptions && (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        size="icon-xs"
                        variant="outline"
                        aria-pressed={planOptions.decompose}
                        aria-label="Decompose"
                        title={
                          planOptions.decompose
                            ? "Decompose — on: exploration runs in parallel, then merges; click to turn off"
                            : "Decompose — explore different areas of the repo in parallel; click to turn on"
                        }
                        onClick={() =>
                          setPlanOptions?.({
                            decompose: !planOptions.decompose,
                            complex: planOptions.complex,
                          })
                        }
                        className={cn(
                          planOptions.decompose &&
                            "border-blue-500/40 bg-blue-500/10 text-blue-400",
                        )}
                      />
                    }
                  >
                    <LayersIcon className="size-3" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Decompose: use sub-agents to explore different areas of the
                    repo in parallel, then merge the results into a single
                    cohesive plan
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        size="icon-xs"
                        variant="outline"
                        aria-pressed={planOptions.complex}
                        aria-label="Complex plan"
                        title={
                          planOptions.complex
                            ? "Complex plan — on: plan + steps + branches + sub-plans; click to turn off"
                            : "Complex plan — for multi-part tickets; click to turn on"
                        }
                        onClick={() =>
                          setPlanOptions?.({
                            decompose: planOptions.decompose,
                            complex: !planOptions.complex,
                          })
                        }
                        className={cn(
                          planOptions.complex &&
                            "border-blue-500/40 bg-blue-500/10 text-blue-400",
                        )}
                      />
                    }
                  >
                    <BracesIcon className="size-3" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Complex plan: for bigger tickets with multiple parts — the
                    agent returns JSON with a markdown plan, steps, branches and
                    sub-plans; each branch can get its own planning run
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            <InputGroupButton
              type="submit"
              size="icon-sm"
              className="ml-auto rounded-full"
              disabled={!canSend}
              aria-label="Send"
            >
              <ArrowUpIcon />
              <span className="sr-only">Send</span>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>

      {promptEditing && (
        <PromptModal
          flowId={flowId}
          nodeKey="plan"
          open={promptEditing}
          onClose={() => setPromptEditing(false)}
          onRun={(prompt, promptIsBody) => {
            setPromptEditing(false);
            void onStartPlan?.({ prompt, promptIsBody });
          }}
        />
      )}
    </div>
  );
}

// ── prompt preview box over the chat (plan tab, before any plan exists) ──────
// Collapsed: a partial preview of the plan prompt with a fade-out. Clicking
// the preview expands it. The edit icon moves the prompt into the prompt
// modal (editor); Generate plan kicks off the run with the current options.
function PlanPromptBox({
  prompt,
  open,
  onToggle,
  onEdit,
  onGenerate,
  generating = false,
}: {
  prompt: string | null; // null = still loading
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onGenerate: () => void;
  generating?: boolean;
}) {
  const loaded = prompt != null;

  return (
    <div className="shrink-0 mb-2.5 rounded-[10px] border border-border bg-background overflow-hidden">
      {/* header row: title + edit action */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">
          Prompt
        </span>
        {prompt && (
          <span className="text-[10.5px] text-muted-foreground">
            {prompt.length.toLocaleString()} chars
          </span>
        )}
        <span className="flex-1" />
        <ChevronDownIcon
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-150",
            !open && "-rotate-90",
          )}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="!size-6"
                aria-label="Edit prompt"
                title="Move the prompt to the prompt editor"
                onClick={onEdit}
              />
            }
          >
            <PencilIcon />
          </TooltipTrigger>
          <TooltipContent>
            <p>Move the prompt to the prompt editor</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* preview body — click toggles expanded/collapsed; the bottom fade
          (in the collapsed state) communicates that more prompt follows */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="relative cursor-pointer select-none transition-colors hover:bg-foreground/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        {loaded ? (
          <pre
            className={cn(
              "m-0 whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground",
              open
                ? "max-h-56 overflow-y-auto scrollbar-thin scroll-py-2"
                : "max-h-16 overflow-hidden",
            )}
          >
            {prompt}
          </pre>
        ) : (
          <div className="px-3 py-3 text-[11px] text-muted-foreground">
            <Spinner /> Loading prompt…
          </div>
        )}
        {!open && loaded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-background via-background/85 to-transparent" />
        )}
        {!open && loaded && (
          <span className="pointer-events-none absolute bottom-1 left-3 text-[10px] font-mono text-muted-foreground/90">
            ··· +{Math.max(prompt.length - 240, 0).toLocaleString()} chars
          </span>
        )}
      </div>

      {/* footer row: generate action */}
      <div className="flex items-center justify-end gap-2 px-2.5 py-1.5">
        <Button
          size="xs"
          variant="default"
          disabled={generating}
          onClick={onGenerate}
        >
          <CompassIcon /> Generate plan
        </Button>
      </div>
    </div>
  );
}

// ── one chat turn ────────────────────────────────────────────────────────────
function ChatMessageRow({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">
              {msg.content}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message>
      <MessageContent className="gap-2">
        <Markdown>{msg.content}</Markdown>
        <MessageFooter className="px-0">
          <MessageActionButton
            label="Copy"
            onClick={() => navigator.clipboard.writeText(msg.content)}
          >
            <BotIcon />
          </MessageActionButton>
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

function MessageActionButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── pending indicator ────────────────────────────────────────────────────────
function PendingRow({ nodeKey }: { nodeKey: string }) {
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <LoaderCircleIcon className="animate-spin" />
        </TraceIcon>
        <TraceTitle>{NODE_LABEL[nodeKey] ?? "Agent"} is working…</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

// ── flow-level event row (MR pushes, pipeline results, checklist edits) ─────
function FlowEventRow({ ev }: { ev: FeedEvent }) {
  const failed = ev.type === "error";
  const steps = parseSteps(ev);

  if (failed || steps) {
    return (
      <Trace>
        <TaskCollapsible
          defaultOpen={failed}
          title={ev.message ?? (failed ? "Failed" : "Update")}
          status={failed ? "error" : undefined}
          icon={failed ? <CircleAlertIcon /> : null}
        >
          <CodeBlock variant={failed ? "destructive" : "default"} size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {failed ? (ev.message ?? "Error") : prettySteps(steps ?? [])}
            </CodeBlockContent>
          </CodeBlock>
        </TaskCollapsible>
      </Trace>
    );
  }

  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <BotIcon />
        </TraceIcon>
        <TraceTitle>{ev.message ?? ev.type}</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseSteps(
  ev: FeedEvent,
): { title?: string; detail?: string; status?: string }[] | null {
  let data: any = {};
  try {
    data = ev.data ? JSON.parse(ev.data) : {};
  } catch {
    data = {};
  }
  const steps = data?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return steps.map((s: any) => ({
    title: s?.title ?? s?.id,
    detail: s?.detail,
    status: typeof s?.status === "string" ? s.status : undefined,
  }));
}

function prettySteps(
  steps: { title?: string; detail?: string; status?: string }[],
): string {
  return steps
    .map((s) => [s.status, s.title, s.detail].filter(Boolean).join(" — "))
    .join("\n");
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── run section = the shadcn Task pattern over Trace ─────────────────────────
function RunSectionRow({ section }: { section: RunSection }) {
  const [open, setOpen] = React.useState<boolean | undefined>(undefined);
  const f = section.finished;
  const failed = sectionHasError(section);
  const status = failed ? "error" : section.active ? "running" : undefined;
  const runningTitle = `${section.label} running`;
  const doneTitle = failed
    ? `${section.label} failed`
    : `${section.label} finished`;

  const meta = [
    section.mode,
    f?.model,
    f?.tokens ? fmtTokens(f.tokens) : null,
    f?.cost ? `${fmtCost(f.cost)}${f.estimated ? " est." : ""}` : null,
    f?.durationMs ? fmtDuration(f.durationMs) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Trace>
      <TraceCollapsible
        open={open ?? status === "running"}
        onOpenChange={setOpen}
      >
        <TraceCollapsibleTrigger>
          <TraceLine status={status}>
            <TraceIcon>
              {status === "running" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : status === "error" ? (
                <CircleAlertIcon />
              ) : (
                <CircleCheckIcon />
              )}
            </TraceIcon>
            <TraceTitle>
              {status === "running" ? runningTitle : doneTitle}
            </TraceTitle>
            {meta && (
              <TraceDescription className="ms-1">{meta}</TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {section.items.map((it, i) => (
              <FeedItemRow key={i} item={it} active={section.active} />
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function sectionHasError(section: RunSection): boolean {
  return section.items.some((it) => {
    if (it.kind === "event") return it.event.type === "error";
    if (it.kind === "tool") return /fail|error/i.test(it.tool.status);
    return false;
  });
}

// ── items inside a run section ───────────────────────────────────────────────
function FeedItemRow({ item, active }: { item: FeedItem; active: boolean }) {
  if (item.kind === "tool") return <ToolRow tool={item.tool} />;
  if (item.kind === "group")
    return <GroupRow group={item.group} active={active} />;
  return <EventRow ev={item.event} />;
}

// Tool call: TraceCollapsible with input/output Code Blocks (Tool pattern)
function ToolRow({ tool }: { tool: ToolCall }) {
  const failed = /fail|error/i.test(tool.status);
  const running =
    !tool.result && !failed && /start|running|tool/i.test(tool.status);
  const truncated = tool.events.some((e) => {
    try {
      return JSON.parse(e.data ?? "{}").truncated;
    } catch {
      return false;
    }
  });

  const summary = summarizeArgs(tool.name, tool.args);
  const input = tool.args ? prettyJson(tool.args) : "";
  const output = tool.result
    ? truncateChars(prettyJson(tool.result), 4000)
    : "";

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? "error" : running ? "running" : undefined}>
          <TraceIcon>
            <ToolIcon name={tool.name} />
          </TraceIcon>
          <TraceTitle>
            {running ? "Running" : failed ? "Failed to run" : "Ran"} {tool.name}
          </TraceTitle>
          {summary && (
            <TraceDescription className="ms-1">{summary}</TraceDescription>
          )}
          {tool.durationMs != null && (
            <TraceDescription className="ms-1">
              {fmtDuration(tool.durationMs)}
            </TraceDescription>
          )}
          {truncated && (
            <TraceDescription className="ms-1">(truncated)</TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted>
        <div className="flex min-w-0 flex-col gap-2 text-foreground">
          {input && (
            <CodeBlock size="sm">
              <CodeBlockContent wrap className="max-h-64">
                {input}
              </CodeBlockContent>
            </CodeBlock>
          )}
          {output && (
            <CodeBlock size="sm" variant={failed ? "destructive" : "default"}>
              <CodeBlockContent wrap className="max-h-64">
                {output}
              </CodeBlockContent>
            </CodeBlock>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

// Thinking / status groups (Task pattern)
function GroupRow({ group, active }: { group: FeedGroup; active: boolean }) {
  if (group.kind === "thinking") {
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <CircleCheckIcon />
            </TraceIcon>
            <TraceTitle>Thought for a while</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="whitespace-pre-wrap">
          {group.text}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  }

  if (group.kind === "assistant") {
    // agent prose inside a run renders as markdown, right in the section
    return <Markdown className="text-muted-foreground">{group.text}</Markdown>;
  }

  // status lines — collapse anything longer than a short sentence
  const multiline = group.text.includes("\n") || group.text.length > 120;
  if (multiline) {
    return (
      <TaskCollapsible title={group.text.split("\n")[0]} icon={null}>
        <CodeBlock size="sm">
          <CodeBlockContent wrap className="max-h-64">
            {group.text}
          </CodeBlockContent>
        </CodeBlock>
      </TaskCollapsible>
    );
  }

  const running = active && groupLastActive(group);
  return (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        {running ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <CircleCheckIcon />
        )}
      </TraceIcon>
      <TraceTitle>{group.text}</TraceTitle>
    </TraceLine>
  );
}

function groupLastActive(_group: FeedGroup): boolean {
  // statuses coalesce by time; if the section is still active the last one is live
  return true;
}

// Non-tool events inside a run (errors get a destructive Code Block)
function EventRow({ ev }: { ev: FeedEvent }) {
  const failed = ev.type === "error";
  if (failed) {
    return (
      <TraceCollapsible defaultOpen={false}>
        <TraceCollapsibleTrigger>
          <TraceLine status="error">
            <TraceIcon>
              <CircleAlertIcon />
            </TraceIcon>
            <TraceTitle>{ev.message ?? "Failed"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <CodeBlock variant="destructive" size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {ev.message ?? "Error"}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  }

  return (
    <TraceLine>
      <TraceIcon>
        <BotIcon />
      </TraceIcon>
      <TraceTitle>{ev.message ?? ev.type}</TraceTitle>
    </TraceLine>
  );
}

// Shared Task-style collapsible used by checklist edits and long status rows
function TaskCollapsible({
  title,
  status,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  status?: "running" | "error";
  icon?: React.ReactNode | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<boolean | undefined>(
    defaultOpen || undefined,
  );
  return (
    <TraceCollapsible open={open ?? false} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceIcon>
            {icon ??
              (status === "running" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <CircleCheckIcon />
              ))}
          </TraceIcon>
          <TraceTitle>{title}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent
        keepMounted
        className="[&_[data-slot=trace-collapsible-content-inner]]:border-l-0 [&_[data-slot=trace-collapsible-content-inner]]:pl-0"
      >
        {children}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
