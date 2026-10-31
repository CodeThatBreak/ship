import { describe, expect, it } from "vitest";

import { assertIntegrationBaseUrl, SsrfError } from "./ssrfGuard";

describe("assertIntegrationBaseUrl", () => {
  it("rejects non-https schemes", async () => {
    await expect(assertIntegrationBaseUrl("http://gitlab.example.com")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects loopback hosts", async () => {
    await expect(assertIntegrationBaseUrl("https://127.0.0.1")).rejects.toThrow(/forbidden|loopback/i);
  });
});
