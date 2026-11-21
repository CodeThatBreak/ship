import type { FeedEvent } from "@/components/chat/timeline";

export const mergeFlowEvents = (
  prev: FeedEvent[],
  incoming: FeedEvent[],
  max: number,
): FeedEvent[] => {
  if (incoming.length === 0) {
    return prev;
  }
  const seen = new Set(prev.map((e) => e.id));
  const merged = [...prev];
  for (const event of incoming) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    merged.push(event);
  }
  merged.sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    if (byTime !== 0) {
      return byTime;
    }
    return a.id.localeCompare(b.id);
  });
  return merged.slice(-max);
};
