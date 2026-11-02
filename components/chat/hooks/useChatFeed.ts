"use client";

import * as React from "react";
import { useFlowChatMessages } from "@/hooks/useFlowChat";
import {
  buildTimelineRows,
  nodeRunSections,
  selectNodeMessages,
  type FeedEvent,
  type TimelineRow,
} from "../timeline";

/**
 * The node's chat feed data: the polled transcript query scoped to the node's
 * messages (and, when set, to one refinement thread), the node's run sections
 * and the interleaved timeline rows, plus the "agent is working" state (shown
 * only while this node's agent owes us a chat reply — not for the whole
 * lifetime of an unrelated run).
 */
export function useChatFeed({
  flowId,
  nodeKey,
  thread = null,
  events,
  nodeKeysByNodeId,
  nodeStatusByNodeId,
  sending,
  busy,
}: {
  flowId: string;
  nodeKey: string;
  /** the active refinement thread (the plan's sub-plan refines); null = main */
  thread?: string | null;
  events: FeedEvent[];
  nodeKeysByNodeId?: Map<string, string>;
  nodeStatusByNodeId?: Map<string, string>;
  sending: boolean;
  busy: boolean;
}) {
  // the flow's chat transcript, polled for the agent's replies; background
  // refetches keep the current rows — only the first fetch shows a skeleton
  const messagesQuery = useFlowChatMessages(flowId);
  const messages = messagesQuery.data;

  const nodeMsgs = React.useMemo(
    () => selectNodeMessages(messages, nodeKey, thread),
    [messages, nodeKey, thread],
  );

  const sections = React.useMemo(
    () =>
      nodeRunSections(events, nodeKeysByNodeId, nodeStatusByNodeId, nodeKey),
    [events, nodeKeysByNodeId, nodeStatusByNodeId, nodeKey],
  );

  const rows = React.useMemo<TimelineRow[]>(
    () =>
      // a refinement tab isolates its conversation: the chronological run /
      // event trail (not attributable to a branch without an events-thread
      // dimension) stays in the main tab
      buildTimelineRows(nodeMsgs, thread ? [] : sections, thread ? [] : events, nodeKey),
    [nodeMsgs, sections, events, nodeKey, thread],
  );

  const last = nodeMsgs[nodeMsgs.length - 1];
  const awaitingReply = sending || (busy && last?.role === "user");
  const itemCount = rows.length + (awaitingReply ? 1 : 0);

  return { messagesQuery, rows, itemCount, awaitingReply };
}
