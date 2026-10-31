import { describe, expect, it } from "vitest";
import { RuleTester } from "eslint";
import { requireNodejsRuntimeRule } from "../eslint/rules/devflow-plugin.mjs";
import { FROZEN_PHASE0_OFFENDERS } from "../eslint/frozen-phase0-offenders.mjs";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

describe("frozen phase-0 offender list", () => {
  it("includes known legacy lib/db violations", () => {
    expect(FROZEN_PHASE0_OFFENDERS).toContain("lib/db/index.ts");
    expect(FROZEN_PHASE0_OFFENDERS).toContain("scripts/check-worktrees.ts");
  });

  it("does not freeze the eslint policy probe module", () => {
    expect(FROZEN_PHASE0_OFFENDERS).not.toContain("lib/eslint-policy-probe.ts");
  });
});

describe("eslint config enforcement", () => {
  it("require-nodejs-runtime flags routes missing the export", () => {
    ruleTester.run("require-nodejs-runtime", requireNodejsRuntimeRule, {
      valid: [
        {
          code: `export const runtime = "nodejs";\nexport const dynamic = "force-dynamic";\n`,
        },
      ],
      invalid: [
        {
          code: `export const dynamic = "force-dynamic";\n`,
          errors: [{ messageId: "missing" }],
        },
      ],
    });
  });

  it(
    "errors on explicit any in a lib file that is not frozen",
    async () => {
      const eslint = new ESLint({ cwd: repoRoot, ignore: false });
      const results = await eslint.lintFiles(["lib/eslint-policy-probe.ts"]);
      const messages = results.flatMap((r) => r.messages);
      expect(
        messages.some(
          (m) =>
            m.ruleId === "@typescript-eslint/no-explicit-any" &&
            m.severity === 2,
        ),
      ).toBe(true);
    },
    30_000,
  );
});
