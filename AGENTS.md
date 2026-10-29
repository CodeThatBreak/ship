# AGENTS.md: DevFlow

Rules for AI agents and contributors working in this repository.

**Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind v4, TanStack Query, better-sqlite3

Where a rule here conflicts with an existing pattern in neighboring files, follow the rule for new code and flag the mismatch in the PR description. Do not rewrite untouched code.

---

## 0. Commands and Definition of Done

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npm run seed:demo    # seed demo data (variants: :reset, fanout, branch-refine, custom)
```

A task is done only when all of these are true:

- [ ] `npm run build` pass
- [ ] Diff is focused: no unrelated reformatting or renames
- [ ] Every async UI has loading, error and empty states
- [ ] New service classes and row mappers have tests
- [ ] Violations found in touched code are fixed; anything else is flagged in the PR description

---

## 1. Safety Rules (read first)

- Never run `seed:demo:reset` or any destructive script against a database that is not the demo DB. Check the DB path first.
- Do not add new dependencies without asking.
- No destructive git or file commands (`reset --hard`, `clean -fd`, `rm -rf`, force push) unless explicitly requested.
- Ask before changing `lib/db/schema.sql`. Schema changes must be coordinated with row mappers in `lib/db/rows.ts`.
- Secrets and env values come only from `lib/config.ts`. Never hardcode them and never commit `.env`.
- Never edit `components/ui/` (shadcn primitives) unless the task explicitly requires it.

---

## 2. Frontend: React Clean Code

### 2.1 Server vs Client

- Server Components by default. Add `"use client"` only when you need state, effects, event handlers or browser APIs.
- Fetch initial data on the server and pass it down or hydrate it into TanStack Query.
- Client-side fetching, mutations and live data go through TanStack Query. Never use raw `useEffect` + `useState` + `fetch`.
- Never import anything from `lib/` into a client component. Server-only modules start with `import "server-only"`.

### 2.2 Component Decomposition

- One component per file. A file over ~200 lines, or with more than one exported component, is a refactor signal.
- A component does one thing. If you describe it with "and", split it.
- Extract in this order:
  1. Presentational subcomponents (pure JSX and props, no data fetching)
  2. Custom hooks (all stateful and data logic)
  3. Container components (compose hooks and presentational children)

```tsx
// Bad: data fetching, layout and rendering in one blob
export function NodePanel({ nodeId }: { nodeId: string }) {
  const [data, setData] = useState(null);
  useEffect(() => { fetch(`/api/nodes/${nodeId}`)... }, [nodeId]);
  // 200 lines of JSX
}

// Good: container delegates to a hook and small children
export function NodePanel({ nodeId }: { nodeId: string }) {
  const { node, isLoading } = useNode(nodeId);
  if (isLoading) return <NodePanelSkeleton />;
  return (
    <Panel>
      <NodePanelHeader node={node} />
      <NodePanelBody node={node} />
    </Panel>
  );
}
```

### 2.3 Directory Organization

```
components/
  <feature>/              # group by feature or domain, not by file type
    index.ts              # small public barrel: only what other features consume
    <Feature>.tsx         # top-level component
    components/           # subcomponents used only by this feature
    hooks/                # feature-local hooks
    utils/                # feature-local pure helpers (no React, no fetching)
    constants/            # feature constants — barrel the values the feature exports
    types/                # feature-local types — barrel the domain types it exports
  ui/                     # shadcn primitives ONLY. Do not add custom components here.
  shared/                 # generic custom components (see 2.4)
hooks/                    # shared cross-feature hooks (useThing.ts, camelCase)
constants/                # shared app-wide constants
types/                    # shared app-wide types
lib/                      # backend and shared utilities (see section 3)
```

- Feature folders are uniform: `components/` for subcomponents, `hooks/` for hooks (the `use` prefix, `hooks/useThing.ts`), `utils/` for pure helpers and utilities (plain TS only — no React, no fetching, no domain constants), `constants/` and `types/` for domain values and shared types. The constants and types directories barrel through `constants/index.ts` and `types/index.ts`, so feature code imports `../constants` / `../types`; a single-domain feature keeps one file per directory. Shared constants: `constants/<domain>.ts`. Shared types: `types/<domain>.ts`.
- Feature-local helpers stay in the feature folder until a second consumer exists.
- Never deep-import across features. Go through the feature's `index.ts`.
- Keep barrels small. Export only the public surface, never everything.

### 2.4 Generic Components Belong in `components/shared/`

A component is generic if it takes only generic props (`label`, `children`, `title`, `variant`) and has no domain types, API calls, feature constants or feature hooks.

- Litmus test: could it be dropped into another feature unchanged? If yes, it lives in `components/shared/`.
- Before creating a component in a feature folder, search `components/ui/` and `components/shared/`. Reuse an equivalent, or extend a near-equivalent with an optional prop.
- When a second feature needs a feature-local component, promote it to `components/shared/`, export it via a barrel, and update imports.
- Use domain-neutral names in shared locations (`Field`, `SectionHeader`), never feature-flavored ones (`IntegrationField`).
- Shared components follow the same standards: typed props, no hardcoded domain strings, stable-ref friendly.

### 2.5 Referential Stability (apply where it matters)

Memoize only when the value is passed to a `memo`'d child, used as a context value, or used as an effect dependency. Do not wrap everything by default.

- Hoist static object, array and function literals outside the component. This is free and always allowed.
- Wrap handlers in `useCallback` and objects in `useMemo` when they flow into one of the three cases above.
- Context provider values are a `useMemo`'d object, stable when state has not changed.
- Never create a callback or ref inside a `.map()` body. Extract a row component that takes primitives and stable callbacks.
- A `memo` component is useless if it receives unstable props, so fix the props first.
- If React Compiler is enabled in this repo, do not add manual memoization except where the compiler cannot reach.

```tsx
// Good: hoisted constants and stable handler passed to a memoized child
const PANEL_DEFAULTS = { width: 420, collapsible: true } as const;
const onSave = useCallback(() => save(id), [id]);
<MemoChild onSave={onSave} config={PANEL_DEFAULTS} />;
```

### 2.6 State and Effects

- Derive values during render instead of syncing them with `useEffect` (no state mirroring). Use a `key` reset if state must reset with a prop.
- `useEffect` is for synchronizing with external systems (network, DOM, subscriptions), not for transforming props.
- State that can be computed from other state must not exist.
- All hooks run unconditionally, before any early return.
- Never suppress `exhaustive-deps`. Fix the deps or restructure.

### 2.7 Constants Instead of Repeated Domain Strings

Domain values must come from named constants. Domain values are: status values, node types, storage keys, query keys, event and subject names, API error codes.

```ts
// constants/flow.ts
export const FLOW_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;
export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];
```

- Closed sets of values: `as const` object plus a derived union type. Use the object in code, never the raw value.
- Repeated literals: `constants/<domain>.ts` on the frontend, a module-level `const` in a backend class or module.
- TanStack Query keys live in one `queryKeys` object so invalidation matches fetching.
- Grep before you type a domain string that likely exists elsewhere, and reuse its constant.
- **Exempt:** Tailwind class strings, aria-labels, log messages, test fixtures and test data. Repeated class strings should still be extracted into a `cn()` helper or a constant when it improves readability.

### 2.8 Loading, Error and Empty States

Every component that renders async data handles all three states.

- **Loading:** a skeleton that mirrors the final layout (same paddings, same element count). Never render nothing, and never use a bare spinner where the layout is known.
- **Error:** a message plus a retry action.
- **Empty:** an explicit empty state.
- With TanStack Query, check `isPending`/`isLoading`, `isError` and empty data explicitly.
- Distinguish `isLoading` from `isFetching`. Background refetches keep showing current data (use `placeholderData` or `keepPreviousData`), not a skeleton.
- Server Components use `loading.tsx` or Suspense boundaries with a skeleton fallback.
- Do not render the real component with undefined data and survive with `node?.title`. That causes flicker and broken partial UI.
- For lists and tables, render N skeleton rows matching the expected row shape.
- Spinners are only for indeterminate inline actions (button submit state, small icon refresh).
- Skeleton components live next to their real component. If reused across features, move them to `components/shared/`.

```tsx
export function NodePanelSkeleton() {
  return (
    <Panel>
      <Skeleton className="h-6 w-40" /> {/* header title */}
      <Skeleton className="h-4 w-full" /> {/* body lines */}
      <Skeleton className="h-4 w-2/3" />
    </Panel>
  );
}
```

### 2.9 Other Conventions

- File naming — component files match their export in PascalCase; everything else is lowercase:
  - Folders start lowercase: `components/flows/plan/masterPlanSection/`, never `plan-section/` or `PlanSection/`.
  - A component file is named after its export in PascalCase — `PlanView.tsx` exports `PlanView`, `MasterPlanSection.tsx` exports `MasterPlanSection`.
  - Component names (the exports) always start with a capital letter in PascalCase: `PlanView`, `SubPlanCard`.
  - Hook files are camelCase with the `use` prefix mirroring the hook name: `useExecutionPick.ts` exports `useExecutionPick`. Never `use-execution-pick.ts`.
  - Constants/types/utils files are camelCase lowercase (`constants/<domain>.ts`, `utils/<name>.ts`).
- Tailwind: follow existing utility patterns. Extract repeated class strings into a constant or `cn()`. Never create a new CSS file.
- Accessibility: interactive elements need labels and keyboard handling. Use `button`, not `div` with `onClick`.
- No `any`. Use proper types, or `unknown` with narrowing as a last resort.
- No direct mutation of props or state.
- Replace large `switch` or `if` chains on string literals in JSX with lookup tables in `constants/`.
- **Early checks over nullish coalescing.** Do not hide missing data behind `??` fallbacks or `?.` chains. Validate with an explicit early return (guard clause) so the happy path stays flat and missing data fails loudly at the top of the function.

```ts
// Bad: fallback chain buries the missing-data case in the middle of the logic
export function getFlowTitle(flow: Flow | undefined) {
  return flow?.title ?? flow?.metadata?.label ?? UNTITLED_FLOW;
}

// Good: guard early, then work with a value you know exists
export function getFlowTitle(flow: Flow): string {
  if (!flow.title) {
    throw new FlowError(`Flow ${flow.id} has no title`);
  }
  return flow.title;
}
```

- Legitimate uses of `??` remain: default UI config values, module-level constants, and places where an empty value is genuinely expected and valid — not as a catch-all for data that should exist.

### 2.10 Fix Bad Practices in Touched Code

When your task touches a file, fix violations of this section in the lines you touch. For anything larger or outside your task, do not fix it silently: flag it in the PR description.

| Bad practice                                                | Fix                                           |
| ----------------------------------------------------------- | --------------------------------------------- |
| Inline object, array or function props to memoized children | `useCallback`, `useMemo` or hoist             |
| `useEffect` copying props into state                        | Derive during render, or `key` reset          |
| Missing or suppressed deps                                  | Fix deps, restructure if it causes loops      |
| `any` types                                                 | Proper types                                  |
| Computable state stored as state                            | Derive it                                     |
| Magic strings or numbers                                    | Named constants                               |
| Data fetching in leaf components                            | Lift to hook or container, use TanStack Query |
| Hooks or browser APIs in a non-`"use client"` file          | Add directive or split server and client      |
| Conditional hooks or hooks after early returns              | Reorder                                       |
| `??` / `?.` fallbacks hiding missing data                   | Early guard clause, fail loudly (see 2.9)     |

---

## 3. Backend: Object-Oriented Services

Stateful and domain logic in `app/api/**` and `lib/**` uses classes. Pure, stateless helpers (`format.ts`, `utils.ts`) may stay as functions.

### 3.1 Class-Based Services

- Each domain concept is a class with one responsibility: `FlowEngine`, `FlowPoller`, `WorktreeManager`, `SecretStore`.
- Dependencies (db handle, config, clients) are constructor-injected private fields.
- No module-level mutable singletons, except through the documented singleton factory in `lib/singleton.ts`.

```ts
// Bad: loose functions and module-level mutable state
let cache = new Map();
export function getFlow(id: string) { ... }

// Good: encapsulated class
export class FlowService {
  constructor(
    private readonly db: Database,
    private readonly cache: FlowCache,
  ) {}

  get(id: FlowId): Flow { ... }
  create(input: CreateFlowInput): FlowId { ... }
}
```

### 3.2 Conventions

- **Encapsulation:** private and readonly fields. Expose behavior methods, not raw data.
- **Composition over inheritance.** Use `abstract` base classes only for genuine shared polymorphic behavior (see `lib/engine/nodes/shared`).
- **Interfaces for boundaries:** one interface per external port (task providers, node registry, git host integrations). Depend on the interface. Follow the patterns in `lib/engine/tasks/task-provider.ts` and `lib/engine/ports/`.
- **Registries over type-string `switch`:** new node and task kinds register into `lib/engine/nodes/registry.ts` and `lib/engine/tasks/registry.ts` instead of adding branches.
- **One class per file**, named after the class in kebab-case (`flow-poller.ts` exports `FlowPoller`).
- **Errors:** throw typed error classes. Routes catch them and map to HTTP responses.
- **Thin route handlers:** `app/api/**/route.ts` only parses and validates input, calls a service method, and serializes the response. No business logic.
- Module-level string constants for repeated domain values (see 2.7).

### 3.3 Runtime and Server Boundaries

- better-sqlite3 is synchronous and Node-only. API routes that touch the DB must use the Node runtime, never Edge.
- `lib/` is server-only. Never import it from client components.
- Dev singletons must survive HMR. Use the `globalThis` pattern implemented in `lib/singleton.ts`, and reuse it instead of inventing a new one.

### 3.4 Validation

- Validate all external input (request bodies, query params, env) at the boundary with Zod.
- Schemas live next to the service or route that owns them, or in `lib/schemas/` when shared.
- Infer types from schemas (`z.infer`) instead of duplicating them.
- No non-null `!` assertions on possibly-missing data. Validate instead.

### 3.5 Migrating Legacy Functional Code

When your task touches an existing function-based module in `lib/`:

- Module-level mutable state: convert to a class with instance fields.
- A cohesive set of 3 or more related functions: group into a service class.
- Small pure utilities: may stay functional.
- Refactor only what your task touches. No drive-by rewrites.

---

## 4. Workflow Rules

1. **Read before writing.** Check how neighboring files solve the same problem and follow existing patterns over generic preferences.
2. **TypeScript strict.** No `any`, no `!` on possibly-missing data.
3. **Keep diffs focused.** No unrelated reformatting or renames. Fix violations only in code your task touches (see 2.10), and flag the rest in the PR description.
4. **Finish with the Definition of Done** in section 0.

---

## 5. Automate With Lint

Prefer failing lint over prose. These should be enforced by ESLint where possible, so agents get immediate feedback:

- `react-hooks/exhaustive-deps` as error
- `@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-non-null-assertion`
- `import/no-restricted-paths` for cross-feature deep imports, `lib/` imports from client code, and custom code inside `components/ui/`
- A restricted-syntax or duplicate-string rule scoped to the domain constants in `constants/`
