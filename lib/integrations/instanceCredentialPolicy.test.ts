import { describe, expect, it } from "vitest";

import { baseUrlOverrideRequiresToken } from "./instanceCredentialPolicy";

describe("baseUrlOverrideRequiresToken", () => {
  it("does not require token when baseUrl is unchanged", () => {
    expect(
      baseUrlOverrideRequiresToken("https://gitlab.example.com", "https://gitlab.example.com/", undefined),
    ).toBe(false);
  });

  it("requires token when baseUrl changes", () => {
    expect(
      baseUrlOverrideRequiresToken("https://gitlab.example.com", "https://evil.test", undefined),
    ).toBe(true);
    expect(
      baseUrlOverrideRequiresToken("https://gitlab.example.com", "https://evil.test", "new-pat"),
    ).toBe(false);
  });
});
