# Task 26: Validate node config at run time

- **Phase:** Phase 2: Engine and backend bugs
- **Depends on:** [Task 07: Delete dead code and legacy back-compat paths](07-remove-dead-and-legacy-code.md)
- **Findings:** CR-076, CR-077, CR-078, CR-079, CR-080, CR-089, CR-200
- **Effort:** M

## Goal

Built-in nodes never check config against `configSchema`, declarative nodes silently drop all instance config on one bad field, decision picks validate against the catalog row, and a JSON agent with no schema always fails.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-076 [Medium] Built-in nodes never validate their config against `configSchema` at run time

- **Status:** Open
- **Type:** Gap
- **Effort:** M
- **Where:** lib/engine/templates/node-config.ts:146-150, lib/engine/nodes/kinds/pipeline/pipeline-node.ts:304-316, lib/engine/nodes/kinds/review/review-node.ts:149, lib/engine/nodes/chains/sdlc-chain.ts:69, lib/engine/flow-engine.ts:711-714 and 1601-1612 (setNodeConfig merges unvalidated)
- **What to do:** Built-ins still read merged config through `configNumber`/`configString`, which accept 0, so `poll_interval_sec: 0` tight-loops the git host. `setNodeConfig` persists instance config without checking it against `configSchema`. Fix: add a base `parseConfig()` that runs `configSchema.parse` at the top of every `run()`/`turn()` and fails the node with a readable error. Validate in `setNodeConfig` too.

### CR-077 [Medium] Declarative nodes silently drop *all* instance config when any field is invalid

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/agent/agent-node.ts:420-423, lib/engine/nodes/kinds/http/http-node.ts:227-230, lib/engine/nodes/kinds/decision/decision-node.ts:272-275, lib/engine/nodes/kinds/script/script-node.ts:289-292
- **What to do:** All four `runConfig()` copies still `safeParse` and silently fall back to `this.def` (the catalog row), discarding every instance override when one field is invalid. Fix: use `parseDeclarativeConfig(kind, config, label)` (lib/engine/nodes/declarative-schemas.ts:148) so the node fails loudly, written once in a shared declarative base.

### CR-078 [Medium] Decision manual picks and legacy expression picks are checked against the catalog choices, not the instance's

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/decision/decision-node.ts:111-137 (applyChoice/validateChoice/choiceLabels default to this.def), 293-302 (awaiting uses this.def labels); caller lib/engine/flow-engine.ts:1578-1579
- **What to do:** Manual picks are still validated against the catalog row's choices, and `applyChoice` evaluates `pass` from `this.def`. Instance-edited choices are rejected and pass-down variables come from the wrong map. Fix: resolve `cfg = runConfig(nodeConfig(ctx))` in `applyChoice` (make ctx required) and thread cfg through `validateChoice`/`awaiting`. Drop the legacy-expression half of this finding. The legacy single global `expression` path still exists (decision-node.ts:213-224, `normalizeChosen` 377-393, `expression` field in declarative-schemas.ts:95) and is a delete-legacy-code candidate.
- **Fix after:** CR-077 (this task)

### CR-079 [Medium] Decision `jsonataTruthy` doesn't follow JSONata truthiness, so empty arrays and objects pick a branch

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/decision/decision-node.ts:15-17, 206
- **What to do:** Unchanged. `jsonataTruthy` still treats `[]`, `{}`, `NaN` and all-falsy arrays as truthy, so an empty filter result picks a branch. Fix: port JSONata's `$boolean` cast (empty array or object, all-falsy arrays and NaN are false) and unit-test the edge cases.

### CR-080 [Medium] Agent node with `output: json` and no schema always fails

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/agent/agent-node.ts:513-553 (541), lib/engine/nodes/kinds/agent/json-schema-lite.ts:43-49, lib/engine/nodes/declarative-schemas.ts:52
- **What to do:** `applyOutput` still calls `jsonSchemaIssues(cfg.output_schema, …)` unconditionally. With the default `output_schema: null`, `check()` throws a plain "invalid output schema (missing)" Error. That Error bypasses the AgentOutputError retry, so every json-output agent without a schema fails. Top-level arrays or primitives are still cast to a record. Fix: guard on `cfg.output_schema && typeof … === "object"` (as script-node.ts:173 does) and reject non-object JSON with a SCHEMA_MISMATCH AgentOutputError.

### CR-089 [Low] The plan knobs `default_complex` and `decompose_default` are shown in the UI but never read

- **Status:** Partly fixed
- **Type:** Code quality
- **Severity:** Low (was Medium)
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/plan/plan-node.ts:97-98, lib/engine/nodes/kinds/plan/constants/config/decompose.ts:3-8, lib/engine/nodes/kinds/plan/constants/config/index.ts:12, lib/engine/nodes/kinds/plan/plan-node.ts:183, lib/engine/nodes/kinds/plan/plan-prompt.ts:87
- **What to do:** `default_complex` was removed. `decompose_default` is still declared and shown in the config form, but nothing reads it. `turn()` builds `PlanInput.parse({prompt, promptIsBody})`, so `decompose` is always false and the decompose prompt branch is unreachable. Fix: apply `cfg.decompose_default` when building the pre-publish input, or remove the knob, its field and the dead branch.

### CR-200 [Low] HTTP output and the decision agent prompt carry unbounded payloads

- **Status:** Open
- **Type:** Bug
- **Effort:** S
- **Where:** lib/engine/nodes/kinds/http/http-node.ts:140-147,182-191,240-245; lib/engine/nodes/kinds/decision/decision-node.ts:234,343-344
- **What to do:** `nodes.output` still stores the full parsed body (up to the 5 MB guard cap) plus all response headers. `safeDigest` truncates string bodies only, so for JSON responses the artifact and the chat `reply` are uncapped too. The decision agent prompt still serializes the entire flow context with `JSON.stringify(vars, null, 2)`. Cap the body in the output and in `safeDigest` for non-string bodies (for example by measuring the serialized size), drop or allowlist response headers, and give the decision prompt a size-capped digest of the context.

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
