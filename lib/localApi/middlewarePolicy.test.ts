import { describe, expect, it } from "vitest";

import { LOCAL_API } from "@/constants/localApi";
import { evaluateLocalApiMiddleware } from "../../localApiMiddleware";

const token = "a".repeat(64);

const mutating = (init: { url?: string; headers?: Record<string, string>; body?: string }): Request => {
  const url = init.url ?? "http://127.0.0.1:3000/api/settings";
  const headers: Record<string, string> = {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    "content-type": "application/json",
    [LOCAL_API.TOKEN_HEADER]: token,
    ...init.headers,
  };
  return new Request(url, {
    method: "POST",
    headers,
    body: init.body ?? "{}",
  });
};

describe("evaluateLocalApiMiddleware", () => {
  it("allows GET without a token", () => {
    const req = new Request("http://127.0.0.1:3000/api/settings", { method: "GET" });
    expect(evaluateLocalApiMiddleware(req, token)).toBeNull();
  });

  it("rejects mutating requests without the local token", () => {
    const req = mutating({ headers: { [LOCAL_API.TOKEN_HEADER]: "wrong" } });
    expect(evaluateLocalApiMiddleware(req, token)?.status).toBe(401);
  });

  it("rejects cross-origin mutating requests even with a token", () => {
    const req = mutating({ headers: { origin: "https://evil.test" } });
    expect(evaluateLocalApiMiddleware(req, token)?.status).toBe(403);
  });

  it("exempts signed webhook routes", () => {
    const req = mutating({
      url: "http://127.0.0.1:3000/api/webhooks/gitlab",
      headers: { [LOCAL_API.TOKEN_HEADER]: "" },
    });
    expect(evaluateLocalApiMiddleware(req, token)).toBeNull();
  });

  it("blocks cross-site fetches when Sec-Fetch-Site is cross-site", () => {
    const req = mutating({ headers: { "sec-fetch-site": "cross-site" } });
    expect(evaluateLocalApiMiddleware(req, token)?.status).toBe(403);
  });
});
