"use client";

import * as React from "react";
import { useFlowChatMessages } from "@/hooks/use-flow-chat";
import {
  buildTimelineRows,
  nodeRunSections,
  selectNodeMessages,
  type FeedEvent,
  type TimelineRow,
} from "../timeline";

/**
 * The node's chat feed data: the polled transcript query scoped to the node's
 * messages, the node's run sections and the interleaved timeline rows, plus
 * the "agent is working" state (shown only while this node's agent owes us a
 * chat reply — not for the whole lifetime of an unrelated run).
 */
export function useChatFeed({
  flowId,
  nodeKey,
  events,
  nodeKeysByNodeId,
  nodeStatusByNodeId,
  sending,
  busy,
}: {
  flowId: string;
  nodeKey: string;
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
    () => selectNodeMessages(messages, nodeKey),
    [messages, nodeKey],
  );

  const sections = React.useMemo(
    () =>
      nodeRunSections(events, nodeKeysByNodeId, nodeStatusByNodeId, nodeKey),
    [events, nodeKeysByNodeId, nodeStatusByNodeId, nodeKey],
  );

  const rows = React.useMemo<TimelineRow[]>(
    () => buildTimelineRows(nodeMsgs, sections, events, nodeKey),
    [nodeMsgs, sections, events, nodeKey],
  );

  const last = nodeMsgs[nodeMsgs.length - 1];
  const awaitingReply = sending || (busy && last?.role === "user");
  const itemCount = rows.length + (awaitingReply ? 1 : 0);

  return { messagesQuery, rows, itemCount, awaitingReply };
}
