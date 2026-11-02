# Task 63: Enable `noUncheckedIndexedAccess`

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 51: Stricter TypeScript flags](51-tsconfig-strictness.md)
- **Findings:** CR-258 (remaining)
- **Effort:** L

## Goal

Turn on `noUncheckedIndexedAccess` in `tsconfig.json` and fix every new error (~189 on the tree measured after Task 51).

## Burn-down order (2026-10-31)

Fix high-file-count areas first so later PRs touch fewer call sites:

| Errors | Area | Notes |
| ---: | --- | --- |
| 30 | `lib/groupEvents.ts` | Event grouping / timeline indexing |
| 15 | `components/template-editor/condition-grammar.ts` | Parser token access |
| 11 | `components/chat/timeline.ts` | Chat UI |
| 10 | `lib/engine/nodes/kinds/plan/plan-node.test.ts` | Test fixtures — guard or narrow |
| 10 | `components/shared/DataTable.tsx` | Column / row access |
| 9 | `lib/engine/nodes/kinds/plan/plan-prompt.test.ts` | Tests |
| 6 | `lib/integrations/gitlab/repo-url.ts` | Regex match groups |
| 6 | `lib/engine/runtime/fanout/step-flow-manager.ts` | Fan-out runtime |
| 6 | `components/flows/panels/BuildView.tsx` | Panel UI |
| 5 | `lib/engine/templates/template-lint.ts` | Template lint |
| 5 | `components/template-editor/types.ts` | Editor types |
| 5 | `components/template-editor/ts-schema-lite.ts` | Schema helper |

Remaining ~82 errors are spread across `lib/` engine runtime, GitLab/Cursor integrations, loaders, and flow panel components (≤5 errors per file). Prefer explicit guards (`if (!row) throw …`) over `!` or silent `??` fallbacks (AGENTS.md §2.9).

## Related (CR-258)

`scripts/*.mjs` seed helpers are still unchecked (`allowJs: true`, `checkJs: false`). After indexed access lands, add `// @ts-check` per script (or a dedicated `scripts/tsconfig.json` with `checkJs`) in a small follow-up PR.

## Done when

- [ ] `noUncheckedIndexedAccess: true` in root `tsconfig.json`
- [ ] `npx tsc --noEmit` clean
- [ ] CR-258 marked **Fixed** in `docs/code-review.md`
