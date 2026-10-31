# Task 50: Convert loose function modules and stop input mutation

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 48: Constructor injection and a smaller `Database` class](48-backend-dependency-injection.md)
- **Findings:** CR-186, CR-216, CR-197, CR-195
- **Effort:** M

## Goal

Small backend modules that AGENTS.md section 3.5 says should be classes, and `EventGrouper` mutating cached query data.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-186 [Low] `secrets.ts` is a loose-function module holding unrelated responsibilities

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/secret-store.ts
- **What to do:** Still a loose-function module, `getSecrets`/`redactSecrets`/`httpAllowlist`, reading the plain `settings` table on every call. Convert it to a `SecretStore` class with an injected db (`all()`, `redact()`), move `httpAllowlist` to an `HttpPolicy`/settings service, and flag plaintext-at-rest storage in the PR description.

### CR-216 [Low] `cursor/credentials.ts` is a cohesive functional module that AGENTS.md section 3.5 says should be a class; setting key repeated

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/integrations/cursor/credentials.ts; loaders/settings.ts; lib/integrations/local-agent/agent.ts
- **What to do:** There are still four loose functions with `"cursor.api_key"` repeated four times, and `setCursorApiKey("")` duplicates `clearCursorApiKey()`. The `local_agent.*` setting keys are still repeated between the agent and the settings route. Fix: create a `CursorCredentials` class and add setting-key constants (for example `constants/settings.ts` or a module const).

### CR-197 [Low] `EventGrouper.group` mutates the caller's event objects

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/groupEvents.ts
- **What to do:** `EventGrouper.group` still writes `_data` and `_nodeKey` onto the input rows, and `nodeRunSections` passes TanStack Query cache data straight in, so cached objects are mutated. `_nodeKey` is recomputed on every call, which makes stale values unlikely in practice, but this still breaks the no-mutation rule. Keep the parsed data in a local `WeakMap`, or shallow-copy each event before enriching it.

### CR-195 [Low] `lib/engine` imports the JSONata evaluator from `components/template-editor` (inverted server→UI boundary)

- **Status:** Fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/jsonata/eval.ts
- **What to do:** The boundary inversion is fixed. The evaluator moved to `lib/jsonata/` (a barrel at `lib/jsonata/index.ts`, on the ESLint client allowlist), the engine shim `lib/engine/jsonata-eval.ts` is deleted, and both the engine and the condition builder import `@/lib/jsonata`. The only thing left is the module-level compile `cache` Map, which the suggested fix said to make an instance field (low value; optional).

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
