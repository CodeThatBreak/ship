# Task 46: Remove `any`, `!` and unsafe casts in the backend

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 03: Harden ESLint so new code cannot regress](03-lint-rule-hardening.md)
- **Findings:** CR-182, CR-183, CR-202, CR-213, CR-173
- **Effort:** M

## Goal

Burn down the backend lint warnings (`any`, non-null assertions) and the `as unknown as` casts. Lower `--max-warnings` as you go.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-182 [Low] `any` types in poller, groupEvents, steps, the Jira provider and the SSRF guard

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/engine/runtime/flow-poller.ts:50,56,68,106,112,142,150; lib/groupEvents.ts:22,67,288; lib/engine/runtime/plan-step-store.ts:303; lib/engine/tasks/providers/jira.ts:207,239,279,286; lib/net/ssrf-guard.ts:149
- **What to do:** Every cited `any` is still present at the moved paths. They currently show up only as lint warnings, because `lib/` is downgraded to warn. Use the `rows.all(FlowRow/BranchRow, …)` mappers in the poller, a Zod schema for Jira responses, `unknown` plus narrowing in groupEvents and plan-step-store, and the `dns.LookupAddress` callback type in the SSRF lookup.

### CR-183 [Low] Non-null `!` assertions on data that may be missing

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/flow-engine.ts:455,1006; lib/engine/runtime/fanout/step-flow-manager.ts:518,526,538-540,1104,1124; lib/engine/templates/template-store.ts:416,608,700,721,793,815; lib/engine/runtime/hook-store.ts:104; lib/engine/runtime/plan-step-store.ts:73,214; lib/engine/templates/template-lint.ts:195,286
- **What to do:** Non-null assertions after DB reads and filters are still there (`this.nodeTemplate(id)!`, `this.flowTemplate(templateId)!`, `hookForNode(...)!`, `s.childFlowId!`, and others). Narrow with type-guard filters, reuse values already read (the loop at template-store.ts:793/815 re-reads `nt`), and throw a typed `NotFoundError` after DB reads.

### CR-202 [Low] `any`, non-null `!` and unsafe casts in the nodes area

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** S
- **Where:** lib/engine/harness/agent-runner.ts:118; lib/engine/nodes/kinds/merge-request/merge-request-service.ts:76-77; lib/engine/nodes/kinds/plan/plan-contract.ts:141,144,172; lib/engine/nodes/kinds/plan/branch-refinement.ts:96
- **What to do:** Fixed: the registry no longer uses `NodeDefinition<any, any>`, and the unconstrained `generatePlan` cast is gone. Still open: `runRowId … ?.id as string` still hides a missing run row (have `persistRun` return the id), `catch (e: any)` remains in merge-request-service, and new `!` assertions (`envelope.subPlan!`, `envelope.plan!`, `s.id!`) need explicit guards.
- **Fix after:** CR-039

### CR-213 [Low] `any` and non-null `!` in area code

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/db/index.ts:75,480-481,525,548,568,858,862,866,897,913,919,973,985; lib/git/local.ts:152,155,165; lib/integrations/gitlab/client.ts:75,317,319; lib/integrations/gitlab/git-host.ts:103,155,251; lib/integrations/jira/service.ts:88,90
- **What to do:** The `get<T = any>`/`all<T = any>`/`run(...args: any[])`/`emitEvent(data?: any)`/`getSetting<T = any>`/`setSetting(value: any)` defaults remain. `upsertRepo` still returns `this.repoById(...)!`, and `parseWebhook` still treats the body as `any` with no Zod validation. Fix: default the generics to `unknown`, throw a typed `RepoNotFoundError`, add Zod schemas for the webhook payloads, and use `catch (e: unknown)`.
- **Fix after:** CR-039

### CR-173 [Low] Type escape hatches: double casts, an unchecked downcast, and type imports from a component barrel

- **Status:** Open
- **Type:** Code quality
- **Effort:** S
- **Where:** loaders/flows.ts:31; app/api/contracts/route.ts:136-142,156; lib/engine/prompts/prompt-preview.ts:92; app/api/templates/route.ts:15; loaders/templates.ts:21; app/api/tasks/live/route.ts:23
- **What to do:** Every escape hatch is still there. The `as unknown as FlowData` cast and the double structural cast in contracts are unchanged. The unchecked plan-def downcast moved from the prompt route into `PromptPreview` (`as unknown as SubPlanPreviewer`). The `({}) as never` catch, the loader's `NodeRow`/`TemplateRow` import from `@/components/templates`, and the no-op `Omit<…, never>` are all unchanged. Fixes: give `flowEngine.get` a declared return type, expose a typed `DeclarativeNode` interface, replace the downcast with a capability or `instanceof` guard, parse request bodies with Zod, and move the row types to `types/`.
- **Fix after:** CR-003 ([Task 10](10-api-input-validation-flows.md))

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
