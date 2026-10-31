import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(() => new Promise(() => {})),
}));

const { lookupAll, RESOLVE_TIMEOUT_MS, SsrfReason } = await import("./ssrf-helpers");

describe("lookupAll", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out slow DNS lookups", async () => {
    vi.useFakeTimers();
    const pending = lookupAll("slow.example.com");
    const rejection = expect(pending).rejects.toBeInstanceOf(SsrfReason);
    await vi.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS);
    await rejection;
  });
});
