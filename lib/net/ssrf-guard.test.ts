import { describe, expect, it } from "vitest";
import { assertUrlPolicy, SsrfError, stripCrossOriginSensitiveHeaders } from "./ssrf-guard";

describe("assertUrlPolicy", () => {
  it("allows http/https hosts on the allowlist", () => {
    const url = assertUrlPolicy("https://api.example.com/v1", ["example.com"]);
    expect(url.hostname).toBe("api.example.com");
  });

  it("rejects disallowed schemes", () => {
    expect(() => assertUrlPolicy("file:///etc/passwd", ["example.com"])).toThrow(SsrfError);
  });

  it("rejects hosts outside the allowlist", () => {
    expect(() => assertUrlPolicy("https://evil.test/x", ["example.com"])).toThrow(/allowlist/);
  });
});

describe("stripCrossOriginSensitiveHeaders", () => {
  it("drops credential headers on cross-origin redirects", () => {
    const from = new URL("https://a.example.com/start");
    const to = new URL("https://b.other.com/next");
    const stripped = stripCrossOriginSensitiveHeaders(from, to, {
      Authorization: "Bearer secret",
      Cookie: "session=1",
      "X-Custom": "keep-me",
    });
    expect(stripped).toEqual({ "X-Custom": "keep-me" });
  });

  it("preserves headers on same-origin redirects", () => {
    const from = new URL("https://api.example.com/a");
    const to = new URL("https://api.example.com/b");
    const headers = { Authorization: "Bearer secret" };
    expect(stripCrossOriginSensitiveHeaders(from, to, headers)).toBe(headers);
  });
});
