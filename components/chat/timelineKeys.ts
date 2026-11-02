import type { FeedItem, RunSection } from "@/lib/groupEvents";
import type { TimelineRow } from "./timeline";

/** Stable React key for a feed item inside a run section. */
export const feedItemKey = (item: FeedItem): string => {
  if (item.kind === "tool") return `t${item.tool.key}`;
  if (item.kind === "group") return `g${item.group.key}`;
  return `e${item.event.id}`;
};

/** Stable React key for a run section row in the chat timeline. */
export const runSectionTimelineKey = (section: RunSection): string => {
  const anchor = section.items.length
    ? feedItemKey(section.items[0])
    : (section.startedAt ?? "empty");
  return `r${section.key}@${anchor}`;
};

/** Stable React key for one interleaved timeline row. */
export const timelineRowKey = (row: TimelineRow): string => {
  if (row.kind === "msg") return `m${row.msg.id}`;
  if (row.kind === "event") return `e${row.ev.id}`;
  return runSectionTimelineKey(row.section);
};
