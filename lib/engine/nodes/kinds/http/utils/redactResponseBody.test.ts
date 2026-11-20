import { describe, expect, it } from "vitest";
import { redactResponseBody } from "./redactResponseBody";

describe("redactResponseBody — the http secret-echo closure (step 04, task 8)", () => {
  it("a response body containing a configured secret is stored redacted", async () => {
    const secret = "sk-live-abc123secret";
    const body = `{"token": "${secret}", "ok": true}`;
    // the stub stands in for secretStore.redact, which masks configured
    // secret values wherever they appear
    const redacted = await redactResponseBody(body, async (s) => s.replaceAll(secret, "[REDACTED]"));
    expect(redacted).not.toContain(secret);
    expect(redacted).toBe('{"token": "[REDACTED]", "ok": true}');
  });

  it("a clean body passes through unchanged", async () => {
    const body = '{"status": "fine"}';
    const redacted = await redactResponseBody(body, async (s) => s.replaceAll("x", "[REDACTED]"));
    expect(redacted).toBe(body);
  });
});
