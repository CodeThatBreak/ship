import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(() => new Promise(() => {})),
}));

const { lookupAll, RESOLVE_TIMEOUT_MS, validateIpLiteral, ipLiteralHost } = await import("./ssrf-helpers");
const { SsrfError } = await import("./ssrf-error");

describe("lookupAll", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out slow DNS lookups", async () => {
    vi.useFakeTimers();
    const pending = lookupAll("slow.example.com");
    const rejection = expect(pending).rejects.toBeInstanceOf(SsrfError);
    await vi.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS);
    await rejection;
  });
});

describe("validateIpLiteral", () => {
  it("parses bracketed IPv6 URL hostnames", () => {
    const host = "[2001:4860:4860::8888]";
    expect(ipLiteralHost(host)).toBe("2001:4860:4860::8888");
    const pinned = validateIpLiteral(host);
    expect(pinned).not.toBeNull();
    if (!pinned) throw new Error("expected pinned address");
    expect(pinned.address).toBe("2001:4860:4860::8888");
  });
});
