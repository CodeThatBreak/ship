import { describe, expect, it } from "vitest";
import { RuleTester } from "eslint";
import { requireNodejsRuntimeRule } from "../eslint/rules/devflowPlugin.mjs";
import { FROZEN_PHASE0_OFFENDERS } from "../eslint/frozenPhase0Offenders.mjs";
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
    expect(FROZEN_PHASE0_OFFENDERS).toContain("lib/db/app.ts");
  });

  it("does not freeze the eslint policy probe module", () => {
    expect(FROZEN_PHASE0_OFFENDERS).not.toContain("lib/eslintPolicyProbe.ts");
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
      const results = await eslint.lintFiles(["lib/eslintPolicyProbe.ts"]);
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

  it(
    "blocks value imports from lib/ in hooks/",
    async () => {
      const eslint = new ESLint({ cwd: repoRoot, ignore: false });
      const results = await eslint.lintText(
        'import { getDb } from "@/lib/db/app";\n',
        { filePath: path.join(repoRoot, "hooks/probe-lib-import.ts") },
      );
      const messages = results.flatMap((r) => r.messages);
      expect(
        messages.some(
          (m) => m.ruleId === "no-restricted-imports" && m.severity === 2,
        ),
      ).toBe(true);
    },
    30_000,
  );

  it(
    "allows type-only imports from lib/ in types/",
    async () => {
      const eslint = new ESLint({ cwd: repoRoot, ignore: false });
      const results = await eslint.lintText(
        'import type { CatalogModel } from "@/lib/modelSpec";\n',
        { filePath: path.join(repoRoot, "types/probe-type-import.ts") },
      );
      const messages = results.flatMap((r) => r.messages);
      expect(messages.filter((m) => m.ruleId === "no-restricted-imports")).toEqual([]);
    },
    30_000,
  );

  it(
    "blocks bare feature barrel imports",
    async () => {
      const eslint = new ESLint({ cwd: repoRoot, ignore: false });
      const results = await eslint.lintText(
        'import { FlowsView } from "@/components/flows";\n',
        { filePath: path.join(repoRoot, "components/flows/probe-barrel-import.tsx") },
      );
      const messages = results.flatMap((r) => r.messages);
      expect(
        messages.some(
          (m) => m.ruleId === "no-restricted-imports" && m.severity === 2,
        ),
      ).toBe(true);
    },
    30_000,
  );
});
