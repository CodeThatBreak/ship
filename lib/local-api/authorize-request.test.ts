import { describe, expect, it, vi } from "vitest";

import { LOCAL_API } from "@/constants/local-api";
import { localApiRequestAuthorized } from "./authorize-request";

describe("localApiRequestAuthorized", () => {
  it("accepts matching x-devflow-local-token header", () => {
    vi.stubEnv(LOCAL_API.TOKEN_ENV, "a".repeat(64));
    const req = new Request("http://127.0.0.1:3000/api/hooks/hk_1/secret", {
      headers: { [LOCAL_API.TOKEN_HEADER]: "a".repeat(64) },
    });
    expect(localApiRequestAuthorized(req)).toBe(true);
    vi.unstubAllEnvs();
  });

  it("rejects missing token", () => {
    vi.stubEnv(LOCAL_API.TOKEN_ENV, "a".repeat(64));
    const req = new Request("http://127.0.0.1:3000/api/hooks/hk_1/secret");
    expect(localApiRequestAuthorized(req)).toBe(false);
    vi.unstubAllEnvs();
  });
});
