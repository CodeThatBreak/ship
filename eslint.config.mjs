import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { FROZEN_PHASE0_OFFENDERS } from "./eslint/frozenPhase0Offenders.mjs";
import { devflowPlugin } from "./eslint/rules/devflowPlugin.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const UI_PRIMITIVES_MESSAGE =
  "components/ui/ holds shadcn primitives only. Put custom code in components/, components/shared/ or a feature folder.";

const PHASE0_DOWNGRADED_RULES = {
  "react-hooks/exhaustive-deps": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-non-null-assertion": "warn",
};

const LIB_CLIENT_IMPORT_PATTERNS = [
  {
    group: [
      "**/lib/**",
      "!**/lib/utils",
      "!**/lib/modelSpec",
      "!**/lib/format",
      "!**/lib/usage",
      "!**/lib/groupEvents",
      "!**/lib/jsonata",
    ],
    message:
      "lib/ is server-only. Only lib/utils, lib/modelSpec, lib/format, lib/usage, lib/groupEvents and lib/jsonata (all pure) may be imported by client code; fetch data through API routes and move shared client types to types/.",
  },
];

const NO_BARREL_MESSAGE =
  "Do not import through index barrels or bare feature paths — import the concrete module file (see AGENTS.md §2.3).";

const FEATURE_BARREL_PATTERNS = [
  {
    regex:
      "^@/components/(builder|chat|flows|layout|settings|shared|tasks|templateEditor|templates)$",
    message: NO_BARREL_MESSAGE,
  },
  {
    regex: "^@/components/shared/dataTable$",
    message: NO_BARREL_MESSAGE,
  },
  {
    regex: "/index$",
    message: NO_BARREL_MESSAGE,
  },
];

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "nextEnv.d.ts",
      "tsconfig.tsbuildinfo",
      "workspaces/**",
      "data/**",
      "lib/eslintPolicyProbe.ts",
    ],
  },

  // Next.js core rules (includes react-hooks and react plugins)
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // AGENTS.md §5: error in app/components/hooks; legacy lib/ offenders stay
      // on the frozen list below until burn-down (Task 03).
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },

  {
    files: FROZEN_PHASE0_OFFENDERS,
    rules: PHASE0_DOWNGRADED_RULES,
  },

  {
    files: ["lib/**/*.ts", "lib/**/*.tsx"],
    ignores: ["lib/eslintPolicyProbe.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
    },
  },

  {
    files: ["app/api/**/route.ts"],
    plugins: {
      devflow: devflowPlugin,
    },
    rules: {
      "devflow/require-nodejs-runtime": "error",
    },
  },

  // components/ui/ is shadcn primitives only: no domain code, feature hooks
  // or constants leak into it. ui primitives may import each other (shadcn
  // composition, button → separator etc.) — only non-ui components/** paths
  // are restricted for them.
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/**",
                "!@/components/ui",
                "!@/components/ui/**",
                "@/hooks/**",
                "@/lib/**",
                "@/constants/**",
              ],
              message: UI_PRIMITIVES_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // No barrel imports (AGENTS.md §2.3). Deep paths to concrete modules are allowed.
  // lib/ is server-only: better-sqlite3, node APIs and env access must never
  // be pulled into client bundles via app/ or components/.
  // Allowlist (client-safe lib modules — pure, no server imports; see AGENTS.md
  // §2.3 and docs/architecture/):
  // - lib/utils (cn() helper)
  // - lib/modelSpec (model-spec helpers/types)
  // - lib/format (run/tool meta formatters — no server deps; grep-verified)
  // - lib/usage (token-usage semantics — deliberately dependency-free)
  // - lib/groupEvents (activity-feed grouping — client-side by design)
  // - lib/jsonata (pure JSONata evaluator — no store/engine/server imports;
  //   used by both the engine runtime and the template editor's compile checks)
  // The lib patterns match both "@/" alias specifiers and relative
  // ("../lib/…") specifiers at any depth. engine/ modules are NOT allowlisted
  // — their client-needed pieces live in types/ and feature-local modules.
  //
  // app/api/** route files are EXEMPT: routes are server-side (Node runtime,
  // better-sqlite3 lives there) — same disposition the server pages got via
  // the sanctioned loaders/ seam.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "hooks/**/*.{ts,tsx}",
      "constants/**/*.ts",
    ],
    ignores: ["components/ui/**", "app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [...LIB_CLIENT_IMPORT_PATTERNS, ...FEATURE_BARREL_PATTERNS],
        },
      ],
    },
  },

  {
    files: ["types/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...LIB_CLIENT_IMPORT_PATTERNS.map((pattern) => ({
              ...pattern,
              allowTypeImports: true,
            })),
          ],
        },
      ],
    },
  },

  // Node implementations go through NodeSupport (lib/engine/nodes/shared) —
  // the seam that owns every node/artifact/run/event write (T1). Def files
  // never import the db module directly. Exempted: the base/seam sidecars
  // themselves (shared/** — NodeSupport, AgentRunner…), the declarative
  // instantiation factory, the collision-free branch-store and
  // merge-request services, and tests (they isolate the DB singleton).
  {
    files: ["lib/engine/nodes/**/*.ts"],
    ignores: [
      "lib/engine/nodes/shared/**",
      "lib/engine/nodes/declarative.ts",
      "lib/engine/nodes/kinds/build/branch-store.ts",
      "lib/engine/nodes/chains/sdlc-chain.ts",
      "lib/engine/nodes/kinds/merge-request/**",
      "**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            // The db module itself (`../db`, `../../db`, `../../../db`) — row
            // mapper *type* imports from `db/rows` stay allowed.
            {
              regex: "^(\\.\\./)+db$",
              message:
                "Node implementations go through NodeSupport (this.support) — every node/artifact/run/event write has a named method there. Import db only from the seam (shared/node-support.ts).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
