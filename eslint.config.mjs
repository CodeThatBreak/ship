import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const SERVER_ONLY_LIB_MESSAGE =
  "lib/ is server-only. Fetch through API routes or server components instead of importing directly.";

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
      // AGENTS.md section 6: enforce the React/TypeScript standards via lint
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },

  // lib/ is server-only: better-sqlite3, node APIs and env access must never
  // be pulled into client bundles via app/ or components/.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/db/**",
                "@/lib/engine/**",
                "@/lib/git/**",
                "@/lib/integrations/**",
                "@/lib/net/**",
                "@/lib/cache",
                "@/lib/config",
                "@/lib/singleton",
              ],
              message: SERVER_ONLY_LIB_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // components/ui/ is shadcn primitives only: no domain code, feature hooks
  // or constants leak into it.
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/**", "@/hooks/**", "@/lib/**", "@/constants/**"],
              message: UI_PRIMITIVES_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // Feature folders export through an index barrel. Deep imports from other
  // files are blocked; feature-internal code uses relative imports.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
];

export default eslintConfig;
