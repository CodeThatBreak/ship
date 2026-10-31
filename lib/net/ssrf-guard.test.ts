import { describe, expect, it } from "vitest";
import { assertUrlPolicy, SsrfError } from "./ssrf-guard";

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
