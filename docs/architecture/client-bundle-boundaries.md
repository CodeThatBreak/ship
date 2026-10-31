# Client bundle boundaries

How DevFlow keeps server-only code out of client bundles. The enforcement lives in
`eslint.config.mjs` (`no-restricted-imports` on `app/`, `components/`, `hooks/`,
and `constants/`). See also [AGENTS.md §2.1–2.3](../../AGENTS.md).

## `lib/` is server-only

Client code must not import `lib/**` except these **pure** modules (grep-verified
no `server-only`, DB, or Node-only imports):

| Module | Role |
|--------|------|
| `lib/utils` | `cn()` / className helpers |
| `lib/modelSpec` | Model-spec helpers and types |
| `lib/format` | Run/tool meta formatters |
| `lib/usage` | Token-usage semantics |
| `lib/groupEvents` | Activity-feed grouping |
| `lib/jsonata` | JSONata evaluation (template editor + engine share it) |

Everything else under `lib/` — engine, DB, integrations, config — stays on the
server. UI data crosses the boundary through **API routes** and the **`loaders/`**
seam (server components and route handlers import services; client islands receive
serialized props or use TanStack Query against `/api/*`).

## Types and template editor

Shared shapes that both server and client need belong in **`types/`**, not in
`lib/engine/**`. The template editor draft/types intentionally avoid importing
engine stores so the builder bundle never pulls server modules.

## Feature barrels

Cross-feature imports go through each feature's `index.ts` barrel, not deep paths
under `@/components/<feature>/…` (see ESLint `FEATURE_BARREL_PATTERNS`).

## Server pages vs client islands

`app/(workspace)/**` pages are Server Components by default. They call loaders
or inline server reads, then pass data into `"use client"` children. That pattern
is why a loader may import `lib/**` even when the route file lives under `app/`.
