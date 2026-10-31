/**
 * Timeline assembly for the chat feed: chat messages, run sections and
 * flow-level events (node_id = null) sorted into one interleaved,
 * time-ordered row list.
 *
 * This is the only module that imports lib/groupEvents directly (its grouper
 * and node-key resolver are used here as values). `lib/groupEvents` is one of
 * the verified-pure allowlisted modules (docs/architecture/client-bundle-boundaries.md,
 * Dispositions) — safe to import directly; this module stays as the feature's
 * single seam until its consumers collapse onto `@/lib/groupEvents` (Phase 6
 * checklist).
 */
import type { ChatMessage } from "@/hooks/use-flow-chat";
import { FLOW_STATUS } from "@/constants/flow";
import {
  eventGrouper,
  flowEventNodeKeys,
  type FeedEvent,
  type FeedGroup,
  type FeedItem,
  type RunSection,
  type ToolCall,
} from "../../lib/groupEvents";

// Re-exported so the chat subcomponents can type against them without each
// importing lib/groupEvents (Phase 6 conflict stays isolated to this module).
export type { FeedEvent, FeedGroup, FeedItem, RunSection, ToolCall };

export type TimelineRow =
  | { kind: "msg"; t: number; msg: ChatMessage }
  | { kind: "run"; t: number; section: RunSection }
  | { kind: "event"; t: number; ev: FeedEvent };

/** Sort key for a run section: while it's running it sits at the time it started
 *  (the block is open/live); a finished section floats to its last event's time,
 *  so chat messages sent mid-run render after (not before) the collapsed block. */
export function sectionSortKey(s: RunSection): number {
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

/** The flow's messages scoped to one node and one thread (node_key empty =
 *  flow-level; thread empty = the main conversation, threaded messages stay
 *  in their refinement tabs). */
export function selectNodeMessages(
  messages: ChatMessage[] | undefined,
  nodeKey: string,
  thread: string | null = null,
): ChatMessage[] {
  return (messages ?? []).filter(
    (m) =>
      (!m.node_key || m.node_key === nodeKey) &&
      // flow-level messages are unthreaded — a refinement tab only shows its
      // node's turns, the main tab only shows unthreaded ones
      (m.thread ?? null) === thread,
  );
}

/** Run sections for this node only (chat is scoped by node_key; events by
 *  run/node-id). A section whose "finished" event fell outside the fetched
 *  event window stays open in the grouper forever — the node's authoritative
 *  status (kept current by the engine/reconciler) is the tiebreaker: a
 *  closed/spinner-less section must never claim to be running when its node
 *  isn't. */
export function nodeRunSections(
  events: FeedEvent[],
  nodeKeysByNodeId: Map<string, string> | undefined,
  nodeStatusByNodeId: Map<string, string> | undefined,
  nodeKey: string,
): RunSection[] {
  return eventGrouper
    .group(events, nodeKeysByNodeId)
    .map((s) => {
      if (!s.active) return s;
      const status = nodeStatusByNodeId?.get(s.nodeId ?? "");
      return status && status !== FLOW_STATUS.RUNNING ? { ...s, active: false } : s;
    })
    .filter((s) => s.nodeKey === nodeKey);
}

/** Interleave the node's messages, run sections and relevant flow-level events
 *  into one time-ordered row list. */
export function buildTimelineRows(
  nodeMsgs: ChatMessage[],
  sections: RunSection[],
  events: FeedEvent[],
  nodeKey: string,
): TimelineRow[] {
  const out: TimelineRow[] = nodeMsgs.map((m) => ({
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
}
