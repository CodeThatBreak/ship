import { describe, expect, it } from "vitest";
import { TemplateRenderer } from "./templateRenderer";

describe("TemplateRenderer.render secrets", () => {
  it("resolves {{secrets.NAME}} when a resolver is provided", () => {
    const out = TemplateRenderer.render("Bearer {{secrets.TOKEN}}", {}, {
      resolveSecret: (name) => (name === "TOKEN" ? "abc" : undefined),
      label: "HTTP",
    });
    expect(out).toBe("Bearer abc");
  });

  it("throws when a referenced secret is missing", () => {
    expect(() =>
      TemplateRenderer.render("{{secrets.MISSING}}", {}, {
        resolveSecret: () => undefined,
        label: "HTTP",
      }),
    ).toThrow(/secret "MISSING"/);
  });
});

describe("TemplateRenderer.renderUrl", () => {
  it("percent-encodes interpolated query values", () => {
    const url = TemplateRenderer.renderUrl(
      "https://api.example.com/search?q={{input.term}}",
      { input: { term: "a&b=c" } },
    );
    expect(url).toBe("https://api.example.com/search?q=a%26b%3Dc");
  });

  it("allows raw segments via raw.*", () => {
    const url = TemplateRenderer.renderUrl(
      "https://api.example.com/{{raw.input.path}}",
      { input: { path: "v1/items" } },
    );
    expect(url).toBe("https://api.example.com/v1/items");
  });
});
