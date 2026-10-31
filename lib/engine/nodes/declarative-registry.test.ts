import { describe, expect, it } from "vitest";
import "./declarative-wiring";
import { declarativeKindRegistry } from "./declarative-registry";

describe("DeclarativeKindRegistry", () => {
  it("parses http config through the registry", () => {
    const parsed = declarativeKindRegistry.parseConfig("http", { url: "https://x.test", method: "GET" }, "Call");
    expect(parsed.url).toBe("https://x.test");
  });

  it("rejects unknown kinds", () => {
    expect(() => declarativeKindRegistry.parseConfig("plan", {}, "X")).toThrow(/unknown declarative kind/);
  });

  it("instantiates a declarative row by kind", () => {
    const def = declarativeKindRegistry.instantiate({
      id: "tmpl_http",
      name: "HTTP",
      description: null,
      kind: "http",
      config: { url: "https://example.com" },
    });
    expect(def?.key).toBe("tmpl_http");
    expect(def?.label).toBe("HTTP");
  });
});
