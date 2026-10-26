# Phase 0: Guardrails — lint baseline

Date: 2026-10-26
Scope: refactor plan **Phase 0** only. Rules are intentionally **warnings** (except noted pre-existing errors); Phase 6 flips them back to `error` and cleans the baseline.

## Commands

```bash
npm run lint   # recursive lint via `eslint .`
npm run build  # pass ✓ (no server-only violations reachable from client bundles)
```

## Counts

| State | Total | Errors | Warnings |
| --- | --- | --- | --- |
| Pre-baseline (before Phase 0 config changes) | 295 | 257 | 38 |
| Post-Phase 0 (this baseline) | 420 | 21 | 399 |

### Post-Phase 0 breakdown by rule

Warnings (Phase 0 scope — flip to `error` in Phase 6):

| Rule | Occurrences | Files |
| --- | --- | --- |
| `@typescript-eslint/no-explicit-any` | 147 | 39 |
| `no-restricted-imports` (lib/ server-only zone) | 112 | 50 |
| `@typescript-eslint/no-non-null-assertion` | 91 | 26 |
| `@typescript-eslint/no-unused-vars` (pre-existing) | 35 | 26 |
| `react-hooks/exhaustive-deps` | 11 (+3 stale `eslint-disable` notices) | 9 |

Errors (13 + 8 are **pre-existing rules outside the Phase 0 warn scope** — see notes):

| Rule | Occurrences | Files |
| --- | --- | --- |
| `no-restricted-imports` (components/ui primitives importing each other) | 13 | 9 |
| `react/no-unescaped-entities` | 6 | 2 |
| `react/no-children-prop` | 1 | 1 |
| `@next/next/no-html-link-for-pages` | 1 | 1 |

## What Phase 0 changed

1. **`react-hooks/exhaustive-deps`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-non-null-assertion`** set to `warn` (they had previously been `error` while the baseline already failed lint: 257 errors). Comment in `eslint.config.mjs` marks the Phase 6 flip.
2. **lib/ server-only zone** added as `warn`: all `lib/**` imports are restricted in `app/**` and `components/**` (both `@/lib/…` alias and relative `…/lib/…` specifiers), **except the documented allowlist** of client-safe pure modules:
   - `lib/utils.ts` — `cn()` helper, no server imports.
   - `lib/modelSpec.ts` — pure model-spec helpers/types; its only import is `constants/models` (plain constants). ✓ verified no server-side imports.
   - Redundant with the allowlist, the previous narrower group list (`@/lib/db/**`, `@/lib/engine/**`, …) was replaced by the full-zone pattern.
3. **`types/model-spec.ts`** created, re-exporting the pure `CatalogModel` / `ModelChoice` types from `@/lib/modelSpec` so future client code can stop importing lib. Existing components intentionally not rewritten (later phase).
4. **`import "server-only"` markers** added to 35 server-side lib modules (list below).

### Flat-config bug fixed in passing

The previous `eslint.config.mjs` had three `no-restricted-imports` blocks with overlapping file scopes. Flat config is last-wins per rule, so the **feature-barrel block shadowed the server-only and components/ui blocks**: neither had ever actually fired for `app/`+`components/` files. The config now merges the feature-barrel patterns and the lib zone into the final block (excluding `components/ui/**`, which keeps its stricter error-level rule). Consequences:

- The 13 components/ui errors above are *pre-existing violations* (latent until now — the rule never ran). They stay errors per the rule's documented intent.
- Feature-barrel enforcement moved from `error` to `warn` together with Phase 0 scope (baseline is currently clean for those patterns).

## server-only markers

Added `import "server-only";` (35 files), verified by `npm run build` passing:

- `lib/config.ts`, `lib/cache.ts`, `lib/singleton.ts`
- `lib/db/index.ts`, `lib/db/rows.ts`
- `lib/engine/node-config.ts`, `hooks.ts`, `flow-context.ts`, `steps.ts`, `secrets.ts`, `templates-yaml.ts`, `worktree-lifecycle.ts`, `nodes/base/pricing-source.ts`, `nodes/base/node-support.ts`, `nodes/base/stream-buffer.ts`, `nodes/plan/plan-meta-parser.ts`, `tasks/providers/jira.ts`
- `lib/git/{local,dep-policy,worktree-setup,worktrees}.ts`
- `lib/net/{ssrf-guard,ssrf-helpers}.ts`
- `lib/integrations/cursorSdk.ts`, `integrations/cursor/{index,client,credentials,agent-port}.ts`, `integrations/gitlab/{index,client,git-host}.ts`, `integrations/jira/service.ts`, `integrations/local-agent/{index,agent,agent-port}.ts`

### Conflicts (NOT marked — reachable from client code)

Computed via reverse dependency closure over client imports (`components/**` + `"use client"` pages):

- **Value-imported directly by client components** (Phase 6 must move these to client-safe homes or API routes):
  - `lib/format.ts` — value-imported by `FlowHeader.tsx`, `panels/FanoutStepList.tsx`, `ChatPanel.tsx`, `app/(workspace)/templates/*.tsx` → **DISPOSED, see Dispositions below (allowlisted)**
  - `lib/usage.ts` — `panels/shared.tsx` → **DISPOSED, see Dispositions below (allowlisted)**
  - `lib/groupEvents.ts` — `ChatPanel.tsx` → **DISPOSED, see Dispositions below (allowlisted)**
  - `lib/engine/jsonata-eval.ts` — `components/template-editor/condition-builder/{condition-builder,expression-input}.tsx` → **DISPOSED, see Dispositions below (relocated)**
  - `lib/engine/nodes/start/contract.ts` — value-imported by `panels/start-view.tsx` (`parseStartContract`); type-only elsewhere → **DISPOSED, see Dispositions below (client seam in types/)**

- **Transitively client-reachable** (any module importing the above, directly or indirectly — the node registry/graph cluster): `lib/engine/{flow,context-lint,poller,prompts,reconcile,templates,merge-arena,step-flows}.ts`, `lib/engine/nodes/{declarative,declarative-schemas,agent/agent-node,base/{index,agent-runner,node-definition,usage-tracker},build/index,build/build-node,build/step-build-node,decision/decision-node,http/http-node,merge-request/index,merge-request/merge-request-service,plan/index,plan/plan-node,pipeline/index,pipeline/pipeline-node,resolve/index,resolve/resolve-node,review/index,review/review-node,script/script-node,sdlc/chain,start/index,start/start-node}.ts`
- **Type-only but imported by a client component** (marked skipped per plan guidance; safe to mark later if desired since `import type` is erased by the bundler):
  - `lib/engine/nodes/base/capabilities.ts` — `ChatPanel.tsx` (`import type NodeCapabilities`)
- **Pure shared modules left client-safe by design** (no markers): the allowlist (`lib/utils.ts`, `lib/modelSpec.ts`) and server-irrelevant pure logic inside `lib/engine` (`nodes/*/schema.ts`, `json-schema-lite.ts`, `keys.ts`, `tool-pairer.ts`, `prompt-defaults.ts`, `tasks/task-provider.ts`, `ports/{agent-runner,git-host}.ts` — interface/type modules).
- **Unused module**: `lib/highlighter.tsx` (no importers anywhere) — not marked; decide its home in a later phase.

## Phase 6 report (final — 2026-10-26)

The Phase 6 checklist became the primary task list for the final refactor phase. Result: `npm run lint` = **0 errors / 159 warnings**, `npx tsc --noEmit` clean, `npm run build` passes.

### What was flipped (eslint.config.mjs)

1. **`react-hooks/exhaustive-deps`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-non-null-assertion` → `error`** (AGENTS §5), repo-wide — with one scoped exception (see 3).
2. **components/ui zone rule fixed**: the rule blocked `@/components/**` wholesale, which falsely flagged shadcn primitives importing each other (13 latent errors, incl. a never-firing parent-dir re-include caveat). The group now lists `@/components/**` with `!@/components/ui` + `!@/components/ui/**` re-includes, so `components/ui/**` may import `components/ui/**` (shadcn self-composition) while nothing else may add domain code to `components/ui/` (hooks/lib/constants stay restricted there).
3. **Backend warn-scope exception (deliberate, documented)**: for `lib/**` and `scripts/**` only, the three flipped rules stay `warn`. All 159 current warnings live there (row mappers, engine internals, check scripts — pre-existing, none introduced by this refactor). Rationale: this was a UI refactor; rewriting types in `lib/db/index.ts` (19), `lib/engine/**` (~46) and `scripts/check-worktrees.ts` (45 `!` + 11 `any`) is backend/maintenance work outside its scope (see out-of-scope list). Everything under `app/**`, `components/**`, `loaders/**` is fully clean at error level.
4. **lib-zone rule → `error`** with `app/api/**` and `components/ui/**` ignored — API route files are server-side (Node runtime; better-sqlite3 lives there) and get the same exemption the server pages received via the sanctioned `loaders/` seam. Allowlist unchanged: `lib/utils`, `lib/modelSpec`, `lib/format`, `lib/usage`, `lib/groupEvents`.

### Final counts

| State | Errors | Warnings |
| --- | --- | --- |
| Phase 0 post-baseline | 21 | 399 |
| Start of Phase 6 (this doc update) | 13 | 155* (components/app scope; repo-wide 172 incl. lib/scripts) |
| **Phase 6 final** | **0** | **159** (all in `lib/**` 104 + `scripts/**` 55) |

Per rule (warnings, all backend/script): `no-explicit-any` 76 · `no-non-null-assertion` 67 · `no-unused-vars` 16 (pre-existing rule, never in the Phase 0 flip scope).

### Phase 6 code changes

- **`constants/flow.ts`** (§2.7): `FLOW_STATUS` (`as const`: pending, running, awaiting_approval, approved, done, failed, waiting, skipped, branch-only `building`, flow-only `active`) + derived `FlowStatus`; `FANOUT_STATE` (failed / awaiting / in-flight / resolved) + `FanoutState`; `STATUS_VARIANT` lookup (the console-merged badge-class map) with `statusVariantOf`, `isTerminalFlowStatus`, `isFailedStatus` helpers. Raw status comparisons in `components/flows/**` (panels, plan, workflow-graph, cockpit), `FlowHeader`/`FlowStatus`/`FlowsView` and the chat seam (`chat/timeline.ts`) now use them; the plan header's duplicated `statusVariant` ternary and `BuildView`'s inline branch-status ternary were consolidated onto the lookup. Non-UI/lib code untouched.
- **panels seam typed**: `PanelProps.action: (a: string, b?: ActionPayload) => Promise<void> | void` (`ActionPayload = Record<string, unknown>`), `.events?: FeedEvent[]`, `.fetchArtifact: (id: string) => Promise<unknown>`; all inline prop clones (ResolveView, PipelineView, BuildView, AgentView, StartView, ReviewView) now destructure `PanelProps`; `PanelShell.action` and `FanoutStepList` aligned to the contract; `icons.tsx`/`FanoutStepList` icon params typed `LucideIcon`. `components/flows/panels` lints with zero `no-explicit-any`/`no-non-null-assertion`.
- **app/components violations fixed** after the flip: 8 route-file violations (`any` → typed boundary cast `ActionBody` + `requireString` guards; `catch (e)` narrowed; `mr_url!` → `flatMap`; unused `PreviewScope` wired as the POST's scope type), `FlowHeader` `sub_flow!` → guard, 7 `!`s + 2 `any`s in `template-editor` (condition-grammar, types, variables, icons), exhaustive-deps in settings (hook object methods destructured so the rule can see them; `harnesses` memoized for callback stability), and 6 unused-import/prop cleanups (`PlanSteps` dropped its unused `flowId` prop, `FilterPicker` now actually renders its `placeholder` prop, `_dropped` destructure → computed `delete`).
- **§2.5 memo audit**: whole-repo reach — only two memo-relevant sites exist (`shared/Markdown` memo is intentional, children-only comparator, stable `markdownProps` hoisted) and `settings/context.tsx`'s provider value, which was an inline object — now a `useMemo` with the state it derives from (no blanket memoization elsewhere; the settings hooks' `useCallback` deps were fixed by destructuring, not by adding memo wrappers).

### Remaining warnings (159) — disposition

Every one is flagged by a rule still at `warn` under the backend scope exception in item 3; none exist in `app/`, `components/`, or `loaders/`.

| Cluster | Count | Why it stays |
| --- | --- | --- |
| `lib/db` | 19 | legacy row-mapper casts/migrations — type work needs its own task |
| `lib/engine/**` (nodes/registry 14×unused-vars, poller 7, step-flows 7, templates 6, node-definition 6, plan/schema+plan-node 6, steps 4, jira provider 4, others) | 67 | engine internals + a pre-existing unused-var cluster |
| `lib/format` / `lib/groupEvents` (allowlisted pure modules) | 5 | `any` inside parse helpers (`parseData`, dataset narrowing) — both verified dependency-free; typing them is backend work |
| `lib/git` / `lib/integrations` / `lib/net` | 13 | SDK-boundary `any`s (gitlab/jira/cursor clients, ssrf-guard hook) |
| `scripts/check-worktrees.ts`, `scripts/check-branch-refine.ts`, `scripts/seed-branch-refine-demo.mjs` | 55 | dev/verification scripts — assertion-heavy by design, no runtime product code |

### Out of scope → carry into the PR description

1. **No test runner configured** — AGENTS requires tests for new service classes/row mappers, but adding a framework is a new-dependency decision (AGENTS §1).
2. **Backend thin-route violation**: `app/api/flows/[id]/prompt/route.ts` (226 lines) exceeds §3.4's thin-route rule (documented by an earlier phase). Related: `app/api/flows/[id]/action/route.ts` now types its body at the boundary but still trusts request JSON — real Zod validation of the 18 node/flow actions belongs to the same backend task; the fanout/plan route family is the natural second candidate.
3. **`jsonata-eval` seam**: `lib/engine/jsonata-eval.ts` is a re-export of `components/template-editor/condition-builder/jsonata-eval.ts` (one lib→components import). Give the pure evaluator a neutral top-level home (`lib/jsonata/` once the lib-zone allowlist covers it, or `packages/`).
4. **Folder-name collision** `components/templates` vs `components/template-editor` — near-identical domains, confusing to navigate; rename proposal: `component-libraries`/`template-registry` or a shared parent.
5. **Backend warn-scope** (this report §3): 159 warnings in `lib/**`+`scripts/**` need a dedicated type-hygiene pass before the three rules can be error-level there; deleting the `scripts/check-*` ad-hoc engines into a shared harness would shrink most of it.
6. **scripts/chat follow-ups from the Phase 0 checklist**: `components/chat/formatters.ts`/`timeline.ts` remain thin seams over allowlisted pure lib modules (`@/lib/format`, `@/lib/groupEvents`) and can be collapsed wholesale (their consumers import the lib modules directly); `lib/highlighter.tsx` still has no importers (unused module — decide its home or delete).

## Dispositions (leftover-seam cleanup, 2026-10-26)

Every candidate was grep-verified free of server imports (db / config / env / engine) before disposition:

- **`lib/format.ts` — ALLOWLISTED (pure: zero imports).** Added to the lib-zone eslint allowlist. The `types/format.ts` re-export indirection is deleted; its two consumers (`components/templates/components/{TemplateColumns,NodeColumns}.tsx`) now import `@/lib/format` directly.
- **`lib/usage.ts` — ALLOWLISTED (pure: zero imports; deliberately dependency-free per its header).** Client consumer: `panels/CostChip.tsx`. Server side (`lib/engine/nodes/base/usage-tracker.ts`) unaffected.
- **`lib/groupEvents.ts` — ALLOWLISTED (pure: zero imports; client-side feed grouping by design).** Its single client seam remains `components/chat/timeline.ts`.
- **`lib/engine/nodes/start/contract.ts` — CLIENT SEAM in `types/start-contract.ts`** (module kept in engine; it is pure data + zod but stays the engine's source of truth for the runtime, contracts API and linter). `types/start-contract.ts` re-exports the types (`StartFieldType`, `StartContractField`) and the one value the flow start panel needs (`parseStartContract`, same pattern as the deleted `types/format.ts` re-export). Updated clients: `flows/panels/StartView.tsx`, `template-editor/constants.ts`, `template-editor/components/start-contract.ts`.
- **`lib/engine/jsonata-eval.ts` — RELOCATED:** the implementation moved to `components/template-editor/condition-builder/jsonata-eval.ts` (pure evaluator; imports only the `jsonata` package); `lib/engine/jsonata-eval.ts` is now a single re-export seam so the engine's internal relative imports (`./jsonata-eval`, …), the decision/http nodes and the two API routes keep working unchanged. **Flagged:** this is a lib → components/ import (one file); Phase 6 may want a neutral top-level home for the evaluator instead.
- **`loaders/` extension** (server-only, the sanctioned lib importer for server pages): `loaders/tasks.ts` (`loadTasksBoot` — providers, repos, default mode, template options), `loaders/flows.ts` (`getFlowListData` added alongside `getFlowCockpitData`), `loaders/templates.ts` (`loadTemplateGallery`, `loadNodeCatalog` added alongside `loadEditorBoot`). `app/(workspace)/{page,flows/page,templates/page,templates/nodes/page}.tsx` now import only from `loaders/` + components.
- **Duplicate hook name split:** `components/templates/hooks/use-node-contract.ts` (per-kind contract, catalog configure dialog) renamed to `use-node-schema-contract.ts`; hook renamed `useNodeContract` → `useNodeSchemaContract`; single consumer `NodeConfigureDialog.tsx` updated (intra-feature relative import, no barrel change). The builder drawer keeps `template-editor/hooks/use-node-contract.ts` (per-instance). Both share the `queryKeys.nodeContracts` cache.
- **Stray pre-existing errors fixed:** `shared/Markdown.tsx` (`children` nested instead of passed as prop on the mermaid code component), `settings/integrations/.../InstanceListError.tsx` (`&apos;`), `flows/FlowHeader.tsx` (`render={<Link href="/" />}` from `next/link`).
- **Result: 13 errors** (only the documented components/ui inter-import set), **155 warnings** (down from 172 in `components app`; all remaining `no-restricted-imports` warnings sit in `app/api/**` server route files).
