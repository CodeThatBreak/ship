import { describe, expect, it } from "vitest";
import { allowlistResponseHeaders, capSerializedPayload, digestJsonText } from "./payloadDigest";

describe("payload-digest", () => {
  it("allowlists safe response headers only", () => {
    expect(
      allowlistResponseHeaders({
        "Content-Type": "application/json",
        "Set-Cookie": "secret=1",
        "X-Request-Id": "abc",
      }),
    ).toEqual({
      "content-type": "application/json",
      "x-request-id": "abc",
    });
  });

  it("caps serialized JSON bodies by measured size", () => {
    const big = { items: Array.from({ length: 5000 }, (_, i) => i) };
    const capped = capSerializedPayload(big, 200);
    expect(typeof capped).toBe("string");
    expect(String(capped).endsWith("… (truncated)")).toBe(true);
  });

  it("digestJsonText truncates oversized context", () => {
    const text = digestJsonText({ x: "y".repeat(30_000) }, 100);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toContain("truncated");
  });
});
