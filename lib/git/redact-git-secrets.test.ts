import { describe, expect, it } from "vitest";

import { redactGitSecrets, redactUrlUserinfo } from "./redact-git-secrets";

describe("redactGitSecrets", () => {
  it("masks URL userinfo and known token values (CR-023)", () => {
    const raw = "fatal: https://oauth2:super-secret@gitlab.example.com/group/repo.git denied";
    expect(redactUrlUserinfo(raw)).toBe(
      "fatal: https://***@gitlab.example.com/group/repo.git denied",
    );
    expect(redactGitSecrets(raw, ["super-secret"])).toBe(
      "fatal: https://***@gitlab.example.com/group/repo.git denied",
    );
  });
});
