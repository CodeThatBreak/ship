import { describe, expect, it } from "vitest";

import { LOCAL_API } from "../../constants/localApi";
import { ensureLocalApiToken, localApiToken } from "./token";

describe("localApiToken", () => {
  it("returns a stable hex token for the process", () => {
    ensureLocalApiToken();
    const first = localApiToken();
    const second = localApiToken();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(process.env[LOCAL_API.TOKEN_ENV]).toBe(first);
  });
});
