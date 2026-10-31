# Task 24: Flow graph snapshot and YAML round-trip

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 23: Graph validation: loops, cycles, edge shapes, one validator](23-graph-semantics-and-validation.md); [Task 12: Transaction API and atomic multi-writes](12-db-transactions.md)
- **Findings:** CR-065, CR-191
- **Effort:** L

## Goal

Running flows re-read the live template graph although the code claims a snapshot, and YAML export breaks on node keys like `true`/`null`.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-065 [Medium] Flows read the live template graph, so the "snapshot" guarantee is only partly true

- **Status:** Open
- **Type:** Bug
- **Effort:** L
- **Where:** lib/engine/templates/template-store.ts:169-179,405-410,494-503,704-722, lib/engine/flow-engine.ts:858-860
- **What to do:** Only `nodes.config` is snapshotted; `graphForFlow` still re-reads the live template (edges, triggers, wait_for, input_map, joins) on every call, `updateNodeTemplate` has no active-flow guard, and the comments still claim "running flows snapshot at creation and are never affected by template edits". Either snapshot the graph onto the flow at create time, or correct the comments and extend `assertNotRunning` to `updateNodeTemplate`/`deleteNodeTemplate` for referenced definitions; memoize the graph per `advanceFrom`.

### CR-191 [Low] YAML export emits edge endpoints unquoted, so node keys `true`/`false`/`null` break the round-trip

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/templates/template-yaml.ts:93,143-148; lib/engine/templates/template-store.ts:787
- **What to do:** Edges are still emitted as unquoted `- [${e.from}, ${e.to}]`, and the key regex still allows `true`/`false`/`null`, so export, then import, of such a template fails with "edge endpoints must be node keys". Emit `JSON.stringify(e.from)`/`JSON.stringify(e.to)`, or reserve those keys in validation.

## Done when

- [x] Every finding above is fixed, or a remaining part is written up in the PR description.
- [x] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [x] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [x] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [x] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
