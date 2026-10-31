import { describe, expect, it } from "vitest";
import { encodedProjectPathFromRepoUrl, hostOfRepoUrl, projectPathFromRepoUrl } from "./repo-url";

describe("repo-url", () => {
  it("parses scp-style git URLs", () => {
    const url = "git@gitlab.example.com:acme/webapp.git";
    expect(hostOfRepoUrl(url)).toBe("gitlab.example.com");
    expect(projectPathFromRepoUrl(url)).toBe("acme/webapp");
    expect(encodedProjectPathFromRepoUrl(url)).toBe(encodeURIComponent("acme/webapp"));
  });

  it("parses https URLs", () => {
    const url = "https://gitlab.example.com/acme/webapp";
    expect(hostOfRepoUrl(url)).toBe("gitlab.example.com");
    expect(projectPathFromRepoUrl(url)).toBe("acme/webapp");
  });

  it("parses ssh:// URLs", () => {
    const url = "ssh://git@gitlab.example.com:2222/acme/webapp.git";
    expect(hostOfRepoUrl(url)).toBe("gitlab.example.com");
    expect(projectPathFromRepoUrl(url)).toBe("acme/webapp");
  });
});
