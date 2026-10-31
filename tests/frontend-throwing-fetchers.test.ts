import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/hooks/fetch-json";
import { fetchJsonOr, settingsQueryOptions } from "@/components/settings/queries";
import {
  repoChoicesQueryOptions,
  taskProvidersQueryOptions,
} from "@/components/builder/queries";

describe("frontend throwing fetchers (Task 14)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchJson throws on non-OK responses (CR-143)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })),
    );
    await expect(fetchJson("/api/example")).rejects.toThrow("nope");
  });

  it("fetchJsonOr keeps the resilient fallback for one-off reads (CR-036)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(fetchJsonOr("/api/detect", null)).resolves.toBeNull();
  });

  it("settings queryFn propagates HTTP failures (CR-036)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );
    const fn = settingsQueryOptions().queryFn;
    if (!fn) throw new Error("expected queryFn");
    await expect(fn({} as never)).rejects.toThrow();
  });

  it("editor boot queries throw instead of returning empty lists (CR-143)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const providersFn = taskProvidersQueryOptions().queryFn;
    const reposFn = repoChoicesQueryOptions().queryFn;
    if (!providersFn || !reposFn) throw new Error("expected queryFn");
    const ctx = {} as never;
    await expect(providersFn(ctx)).rejects.toThrow();
    await expect(reposFn(ctx)).rejects.toThrow();
  });
});
