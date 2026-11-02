import { afterEach, describe, expect, it, vi } from "vitest";
import { patchSettings } from "./queries";

describe("patchSettings (CR-038)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when PATCH /api/settings is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "bad patch" }), { status: 400 })),
    );
    await expect(patchSettings({ default_model: "gpt" })).rejects.toThrow("bad patch");
  });
});
