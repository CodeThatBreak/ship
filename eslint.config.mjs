import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const UI_PRIMITIVES_MESSAGE =
  "components/ui/ holds shadcn primitives only. Put custom code in components/, components/shared/ or a feature folder.";

const FEATURE_BARREL_MESSAGE =
  "Import feature code through the feature's index barrel, not through deep paths.";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      "workspaces/**",
      "data/**",
    ],
  },

  // Next.js core rules (includes react-hooks and react plugins)
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      // AGENTS.md section 6 (Phase 6 final state): these run at error level in
      // the app tree. lib/** and scripts/** stay at warn — their pre-existing
      // violations (row mappers, check scripts) are backend/cleanup work
      // outside this UI refactor; see docs/phase0-baseline.md Phase 6 report.
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },

  // lib/** + scripts/** backend & maintenance scripts: the flipped Phase-0
  // rules stay "warn" here (documented pre-existing violations — no `any` or
  // `!` rewrites were in this refactor's scope; fixing a row mapper's types or
  // check-worktrees.ts assertions needs its own backend task).
  {
    files: ["lib/**/*.ts", "scripts/**/*.{ts,mjs}"],
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
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

  // Feature folders export through an index barrel. Deep imports from other
  // files are blocked; feature-internal code uses relative imports.
  //
  // lib/ is server-only: better-sqlite3, node APIs and env access must never
  // be pulled into client bundles via app/ or components/.
  // Allowlist (the only client-safe lib modules, all pure — no server
  // imports, verified in docs/phase0-baseline.md):
  // - lib/utils (cn() helper)
  // - lib/modelSpec (model-spec helpers/types)
  // - lib/format (run/tool meta formatters — no server deps; grep-verified)
  // - lib/usage (token-usage semantics — deliberately dependency-free)
  // - lib/groupEvents (activity-feed grouping — client-side by design)
  // - lib/jsonata (pure JSONata evaluator — no store/engine/server imports;
  //   used by both the engine runtime and the template editor's compile checks)
  // The lib patterns match both "@/" alias specifiers and relative
  // ("../lib/…") specifiers at any depth. engine/ modules are NOT allowlisted
  // — their client-needed pieces live in types/ and feature-local modules
  // instead (see the baseline's conflict notes).
  //
  // app/api/** route files are EXEMPT: routes are server-side (Node runtime,
  // better-sqlite3 lives there) — same disposition the server pages got via
  // the sanctioned loaders/ seam.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["components/ui/**", "app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // gitignore-style matching (the `ignore` engine underneath this
              // rule): ignore everything under any lib/ directory, then
              // re-include the client-safe allowlist.
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
            // Single-file features with an index barrel
            {
              group: ["@/components/panels/!(index.tsx)"],
              message: FEATURE_BARREL_MESSAGE,
            },
            {
              group: ["@/components/shared/!(index.ts)"],
              message: FEATURE_BARREL_MESSAGE,
            },
            {
              group: ["@/components/template-editor/!(index.ts)"],
              message: FEATURE_BARREL_MESSAGE,
            },
            // settings has per-domain barrels (repos, general, integrations);
            // block everything beneath them
            {
              group: [
                "@/components/settings/*/*",
                "@/components/settings/*/*/*",
                "@/components/settings/*/*/*/**",
              ],
              message: FEATURE_BARREL_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // Node implementations go through NodeSupport (lib/engine/nodes/base) —
  // the seam that owns every node/artifact/run/event write (T1). Def files
  // never import the db module directly. Exempted: the base/seam sidecars
  // themselves (base/** — NodeSupport, AgentRunner…), the declarative
  // instantiation factory, the collision-free branch-store and
  // merge-request services, and tests (they isolate the DB singleton).
  {
    files: ["lib/engine/nodes/**/*.ts"],
    ignores: [
      "lib/engine/nodes/base/**",
      "lib/engine/nodes/declarative.ts",
      "lib/engine/nodes/build/branch-store.ts",
      "lib/engine/nodes/sdlc/chain.ts",
      "lib/engine/nodes/merge-request/**",
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
                "Node implementations go through NodeSupport (this.support) — every node/artifact/run/event write has a named method there. Import db only from the seam (base/node-support.ts).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
