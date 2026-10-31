# Task 40: Template editor: stable references and contract requests

- **Phase:** Phase 3: Frontend bugs and gaps
- **Depends on:** [Task 39: Template editor: fields that write correct values](39-editor-fields-and-effects.md)
- **Findings:** CR-144, CR-145
- **Effort:** M

## Goal

Every drawer keystroke rebuilds all XYFlow nodes and re-keys the contract query, and the whole instance config is serialized into a GET query string.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-144 [Medium] Contract and preview queries put the full node config into a GET URL and re-key on every keystroke

- **Status:** Open
- **Type:** Bug
- **Effort:** M
- **Where:** components/template-editor/types.ts:62-78, components/template-editor/types.ts:86-97, components/template-editor/hooks/use-node-contract.ts:34-46, components/builder/hooks/use-instance-contracts.ts:81-92, components/builder/hooks/use-instance-contracts.ts:143-150, components/template-editor/hooks/use-upstream-groups.ts:61-62, components/templates/hooks/use-node-schema-contract.ts:32-37, app/api/contracts/route.ts:38-50
- **What to do:** `contractsUrl` and `kindContractUrl` still serialize the whole instance config (prompts and script source) into the GET query string, and `/api/contracts` is GET-only. Large configs can hit 431, and every non-debounced field edit re-keys the query and leaves a cache entry. Only the prompt body is debounced (PromptTab) and `keepPreviousData` is set, both already true at review time. Fix: POST only the contract-relevant subset (`output_schema`, `choices`, `contract`) keyed by a stable hash of it, and debounce other field writes.

### CR-145 [Medium] Unstable `machine`/`layout` objects and inline callbacks defeat memoization; the canvas rebuilds every render

- **Status:** Open
- **Type:** Performance
- **Effort:** S
- **Where:** components/template-editor/hooks/use-template-draft.ts:205-220, components/template-editor/hooks/use-node-positions.ts:71-77, components/builder/EditorPage.tsx:202-226, components/template-editor/components/BuilderFlow.tsx:82-126, components/template-editor/components/BuilderFlow.tsx:160-166, components/template-editor/components/BuilderFlow.tsx:207, components/builder/hooks/use-editor-save.ts:115
- **What to do:** Both hooks still return fresh object literals (`resetPositions` is still an inline arrow), and `useEditorSave` and `useEditorActions` depend on the whole `machine`/`layout` objects. EditorPage still passes inline `onNodeOpen`/`onEdgeOpen`/`onApi` lambdas into `rfNodes`/`rfEdges` memo deps, so every drawer keystroke rebuilds all XYFlow nodes and edges. React Compiler is not enabled (`next.config.mjs`). Right-click still duplicates the node. Fix: `useMemo` the returned APIs, depend on the individual stable callbacks, `useCallback` the EditorPage handlers, and move duplicate behind a context menu.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
