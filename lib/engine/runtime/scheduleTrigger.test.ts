import { describe, expect, it } from "vitest";
import { nextScheduleFireAt } from "./scheduleTrigger";

describe("nextScheduleFireAt", () => {
  const hour = 60 * 60_000;

  it("does not drift when the tick is late", () => {
    const due = Date.parse("2026-01-01T10:00:00.000Z");
    const now = due + 5 * 60_000;
    expect(nextScheduleFireAt(due, now, 60)).toBe(due + hour);
  });

  it("skips missed slots when far behind", () => {
    const due = Date.parse("2026-01-01T10:00:00.000Z");
    const now = due + 2.5 * hour;
    expect(nextScheduleFireAt(due, now, 60)).toBe(due + 3 * hour);
  });
});
