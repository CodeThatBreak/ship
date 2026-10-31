import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, patchJson, postJson } from "@/hooks/fetch-json";
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

  it("postJson and patchJson throw with server messages on non-OK bodies (CR-153)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify({ error: "bad patch" }), { status: 400 });
        }
        return new Response(JSON.stringify({ error: "bad post" }), { status: 502 });
      }),
    );
    await expect(postJson("/api/tasks/materialize", "{}")).rejects.toThrow("bad post");
    await expect(patchJson("/api/tasks/1", "{}")).rejects.toThrow("bad patch");
  });

  it("postJson rejects HTML error pages without a JSON parse failure (CR-153)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>error</html>", { status: 500 })),
    );
    await expect(postJson("/api/flows", "{}")).rejects.toThrow("Request failed (500)");
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
