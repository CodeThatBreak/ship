import { describe, expect, it } from "vitest";
import { TemplateRenderer } from "./template-renderer";

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
