import "server-only";

/**
 * Next schedule fire time after a due interval trigger fires (or the process
 * was late). Advances from the previous `due` in whole intervals so tick
 * lateness does not accumulate (`now + interval` drift).
 */
export const nextScheduleFireAt = (
  dueMs: number,
  nowMs: number,
  intervalMin: number,
): number => {
  const intervalMs = intervalMin * 60_000;
  if (!Number.isFinite(dueMs) || intervalMs <= 0) return nowMs + intervalMs;
  if (nowMs < dueMs) return dueMs;
  const slots = Math.ceil((nowMs - dueMs) / intervalMs);
  return dueMs + slots * intervalMs;
};
