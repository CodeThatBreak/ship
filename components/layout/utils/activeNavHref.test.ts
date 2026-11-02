import { describe, expect, it } from "vitest";
import { pickActiveNavHref } from "./activeNavHref";

const NAV = [
  { href: "/" },
  { href: "/flows" },
  { href: "/templates" },
  { href: "/templates/nodes" },
  { href: "/settings" },
  { href: "/settings/repositories" },
  { href: "/settings/integrations" },
] as const;

describe("pickActiveNavHref", () => {
  it("highlights tasks only on the workspace root", () => {
    expect(pickActiveNavHref("/", NAV)).toBe("/");
    expect(pickActiveNavHref("/flows", NAV)).toBe("/flows");
    expect(pickActiveNavHref("/flows/abc", NAV)).toBe("/flows");
  });

  it("picks the most specific prefix for nested template routes", () => {
    expect(pickActiveNavHref("/templates/nodes", NAV)).toBe("/templates/nodes");
    expect(pickActiveNavHref("/templates/nodes/custom", NAV)).toBe(
      "/templates/nodes",
    );
    expect(pickActiveNavHref("/templates/tmpl-1", NAV)).toBe("/templates");
  });

  it("does not let /settings steal nested settings paths", () => {
    expect(pickActiveNavHref("/settings/integrations", NAV)).toBe(
      "/settings/integrations",
    );
    expect(pickActiveNavHref("/settings", NAV)).toBe("/settings");
  });
});
