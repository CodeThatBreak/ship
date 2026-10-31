import { describe, expect, it } from "vitest";
import { TtlCache } from "./cache";

describe("TtlCache", () => {
  it("evicts oldest entries when over the size cap", () => {
    const cache = new TtlCache<string>(60_000, 2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("keeps expired entries briefly for stale entry() reads", () => {
    const cache = new TtlCache<string>(10, 10);
    cache.set("k", "v");
    const entry = cache.entry("k");
    expect(entry?.value).toBe("v");
  });
});
