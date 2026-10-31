/** Resolve panel clock copy from schedule timestamp and a client "now" (ms). */
export const resolveClockLabel = (
  scheduledAt: number | null,
  nowMs: number,
): string | null => {
  if (scheduledAt == null) return null;
  if (scheduledAt > nowMs) {
    return new Date(scheduledAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return "pipeline-gated";
};
