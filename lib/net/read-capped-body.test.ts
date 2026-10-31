import { describe, expect, it } from "vitest";
import { readCappedUtf8Body, RequestBodyTooLargeError } from "./read-capped-body";

const post = (init: { body?: BodyInit; headers?: Record<string, string> }): Request =>
  new Request("http://localhost/api/hooks/hk_test", { method: "POST", ...init });

describe("readCappedUtf8Body", () => {
  it("rejects when Content-Length exceeds the cap before reading (CR-176)", async () => {
    await expect(
      readCappedUtf8Body(
        post({ headers: { "content-length": "2000000" }, body: "x" }),
        1_000_000,
      ),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("counts UTF-8 bytes, not JS string length (CR-176)", async () => {
    const body = "€".repeat(400_000);
    await expect(readCappedUtf8Body(post({ body }), 1_000_000)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it("returns the body when under the cap", async () => {
    const raw = await readCappedUtf8Body(post({ body: '{"ok":true}' }), 1_000_000);
    expect(raw).toBe('{"ok":true}');
  });
});
