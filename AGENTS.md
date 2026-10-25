# AGENTS.md — DevFlow

Guidelines for AI agents and contributors working in this repository.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · TanStack Query · better-sqlite3

---

## 1. Frontend — React Clean Code Principles

### 1.1 Component Decomposition

- One component per file. A file longer than ~200 lines or with more than one exported component is a refactor signal.
- A component does **one thing**. If you can describe it with "and", split it.
- Extract in this order of preference:
  1. **Presentational subcomponents** — pure JSX+props, no data fetching.
  2. **Custom hooks** — all stateful/data logic moves to `hooks/`.
  3. **Container components** — compose hooks + presentational children.

```tsx
// ❌ Bad: data fetching + layout + rendering in one blob
export function NodePanel({ nodeId }: { nodeId: string }) {
  const [data, setData] = useState(null);
  useEffect(() => { fetch(`/api/nodes/${nodeId}`)... }, [nodeId]);
  // ...200 lines of JSX
}

// ✅ Good: container delegates to hook + small children
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

### 1.2 Directory Organization (by hierarchy)

```
components/
  <feature>/              # group by feature/domain, not by file type
    index.ts              # public barrel — only what's consumed outside
    <Feature>.tsx         # top-level component
    components/           # subcomponents used only by this feature
      <SubA>.tsx
      <SubB>.tsx
    hooks/                # feature-local hooks
    constants.ts          # feature constants (never inline magic strings/numbers)
    types.ts              # feature-local types
  ui/                     # generic primitives (shadcn) — no business logic
hooks/                    # shared, cross-feature hooks (use-thing.ts, kebab-case)
constants/                # shared app-wide constants
types/                    # shared app-wide types
lib/                      # backend + shared utilities (see §2)
```

**Rules:**
- New shared hooks go in `hooks/use-<name>.ts`. New shared constants in `constants/<domain>.ts`. New shared types in `types/<domain>.ts`.
- Feature-local helpers stay inside the feature folder — do not promote to `hooks/`/`constants/` until a second consumer exists.
- Never import deep paths across features (`components/a/components/Foo.tsx`); go through the feature's `index.ts` barrel.
- `components/ui/` must stay generic: no domain types, no API calls, no app constants.

### 1.3 Stable Reference Props (referential stability)

Every prop passed to a child must be referentially stable across renders unless it intentionally changes. This prevents unnecessary re-renders and effect re-runs.

**Mandatory:**
- Event handlers passed to children/memoized components: wrap with `useCallback`.
- Objects/arrays passed as props: `useMemo`, or hoist the literal **outside the component** if it never changes.
- Values derived from props/state used in `useEffect` deps: memoize or compute inside the effect.
- Context providers: split value into a `useMemo`'d object; keep `value` stable when state hasn't changed.

```tsx
// ❌ Bad: new function + new object identity every render
<Child onSave={() => save(id)} config={{ retries: 3, timeout: 500 }} />

// ✅ Good: stable references
const onSave = useCallback(() => save(id), [id]);
<Child onSave={onSave} config={DEFAULT_CONFIG} /> // hoisted module constant
```

```tsx
// ✅ Hoist static literals — zero cost, guaranteed stable
const STATUS_OPTIONS = ["idle", "running", "done"] as const;
const PANEL_DEFAULTS = { width: 420, collapsible: true } as const;
```

**Rules:**
- Prefer deriving during render over syncing via `useEffect` (avoid "state mirroring").
- `useEffect` is for synchronizing with **external systems** (network, DOM, subscriptions) — not for transforming props.
- Never create a new ref/callback inside a `.map()` render body; extract a row component that takes primitives + stable callbacks.
- Components that receive objects and render expensive trees must be wrapped in `memo` **and** only receive stable props — otherwise `memo` is useless.

### 1.4 Bad Practices — Fix on Encounter

When an agent encounters any of these in existing code, **fix it in the same change** (or flag it if the fix is too large for the current task):

| Bad practice | Fix |
|---|---|
| Inline object/array/function props to memoized children | `useCallback`/`useMemo` or hoist |
| `useEffect` copying props into state | Derive during render, or `key`-reset |
| Missing dependency arrays / suppressed deps (`// eslint-disable`) | Fix deps; restructure if it causes loops |
| `any` types | Proper types; `unknown` + narrowing as last resort |
| State that can be computed from other state | Remove it; derive |
| Giant `switch`/`if` chains on string literals in JSX | Map to `constants/` lookup tables |
| Magic strings/numbers | Named constants |
| Mutating props/state directly | Immutable updates |
| `index.ts` barrel exporting everything | Export only the public surface |
| Data fetching inside leaf components | Lift to hook/container; use TanStack Query |
| Non-`"use client"` file importing hooks/browser APIs | Add directive or split server/client |
| Conditional hooks / hooks after early returns | Reorder so all hooks run unconditionally |

### 1.5 General React Conventions

- Server Components by default; add `"use client"` only when needed (state, effects, event handlers, browser APIs).
- Data fetching on the client goes through **TanStack Query**, never raw `useEffect` + `useState` + `fetch`.
- Name components with PascalCase files matching the export; hooks as `use-<name>.ts`; constants/types files lowercase.
- Tailwind: use existing utility patterns; extract repeated class strings into a constant or `cn()` helper — never a new CSS file.
- Accessibility: interactive elements need keyboard handling and labels; don't use `div` with `onClick` where a `button` works.

### 1.6 No Repeated String Literals — Use Constants

Any string literal used **more than once** (or compared against in more than one place) must be a named constant, not free text typed inline in functions.

**When a string appears 2+ times → constant. When it's part of a closed set of values → `as const` object or union type.**

```tsx
// ❌ Bad: "running" duplicated across functions — one typo silently breaks everything
if (flow.status === "running") { ... }
const active = flows.filter((f) => f.status === "running");

// ✅ Good: single source of truth
// constants/flow.ts
export const FLOW_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;
export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];
```

```ts
// ❌ Bad: repeated free-text keys in multiple functions
localStorage.setItem("devflow:activeFlow", id);
const saved = localStorage.getItem("devflow:activeFlow");

// ✅ Good: constant exported once, imported everywhere
// constants/storage-keys.ts
export const STORAGE_KEYS = { ACTIVE_FLOW: "devflow:activeFlow" } as const;
```

**Rules:**
- Repeated literals → `constants/<domain>.ts` (frontend) or a module-level `const` (backend class/module).
- Sets of related strings → `as const` object + derived union type; use the object's keys in code, never the raw values.
- Event/subject names, storage keys, status values, node types, API error codes, and query keys **always** come from constants.
- Query keys for TanStack Query belong in a `queryKeys` constant object so invalidation matches fetching.
- A literal may stay inline only if it appears exactly once and is self-explanatory (e.g. an aria-label).
- Grep before you type: if you're about to write a string that likely exists elsewhere (`"running"`, `"agent"`, `"merge-request"`), find and reuse its constant instead of adding a duplicate.

### 1.7 Generic Components Belong in a Shared, Discoverable Location

If a component is **generic** — it takes only generic props (`label`, `children`, `title`, `variant`, no domain types, no API calls, no feature constants) — it must live where other features can find and reuse it, **not** buried inside one feature's folder.

**Real example from this repo:** `components/settings/integrations/components/Field.tsx` is a perfectly reusable `<Field label children>` wrapper, but its location makes it invisible to every other feature. Components like this belong in `components/ui/` (if it's a form/primitive) or `components/shared/`.

```
components/
  ui/                     # generic primitives — Field, Modal, Empty, …
  shared/                 # generic app-level components that aren't shadcn primitives
    Field.tsx             # ✅ moved here — reusable by any feature
  settings/
    integrations/
      components/         # ❌ Field.tsx should NOT live here — it's not integration-specific
```

**Rules:**
- **Litmus test:** could this component be dropped into any other feature without modification? If yes, it's shared. If it imports domain types, feature constants, or feature hooks, it stays feature-local.
- Before creating a new component inside `components/<feature>/components/`, **search `components/ui/` and `components/shared/` first** — if an equivalent exists, use it; if a near-equivalent exists, extend it (add an optional prop) instead of duplicating.
- When a feature-local component is needed by a second feature, **promote it**: move to `components/shared/` (or `components/ui/` for primitives), export via a barrel, and update all imports. Don't cross-import between feature folders.
- Shared components must keep the same quality bar: typed props, no hardcoded domain strings (§1.6), stable-ref-friendly (§1.3).
- Naming: shared components use domain-neutral names (`Field`, `SectionHeader`, `ConfirmButton`) — never feature-flavored names (`IntegrationField`) in shared locations.

### 1.8 Always Handle Loading States — Skeletons, Not Generic Spinners

Every component that renders async data **must** handle its loading state. Never render nothing, never leave stale content flashing, and never use a bare spinner where layout is known.

**Use skeleton placeholders that mirror the final layout** — they preserve structure, prevent layout shift (CLS), and feel faster than a spinner:

```tsx
// ❌ Bad: no loading state at all → blank/jumpy UI
export function NodePanel({ nodeId }: { nodeId: string }) {
  const { node } = useNode(nodeId);
  return <NodePanelHeader node={node} />; // node is undefined while loading!
}

// ❌ Bad: generic spinner where the layout is already known
if (isLoading) return <Spinner />;

// ✅ Good: skeleton matching the real layout
if (isLoading) return <NodePanelSkeleton />;
```

```tsx
// ✅ Skeleton mirrors the shape it replaces (use existing ui/ primitives)
export function NodePanelSkeleton() {
  return (
    <Panel>
      <Skeleton className="h-6 w-40" />          {/* header title */}
      <Skeleton className="h-4 w-full" />         {/* body lines */}
      <Skeleton className="h-4 w-2/3" />
    </Panel>
  );
}
```

**Rules:**
- Every async component must cover all three states: **loading** (skeleton), **error** (message + retry), and **empty** (nothing to show). With TanStack Query, check `isLoading`/`isPending`, `isError`, and empty data explicitly.
- Skeletons match the real component's dimensions and structure — same paddings, same element count. A skeleton that looks nothing like its content is worse than a spinner.
- Skeleton components live next to their real component (`<Feature>Skeleton` in the same file or feature folder); if a skeleton is reused across features, it goes to `components/shared/` (§1.7).
- Spinners are acceptable only for **indeterminate inline actions** (button submit state, small icon-level refresh) where no layout is known — never as a full-component placeholder.
- Never render the real component with undefined data and rely on optional chaining (`node?.title`) to "survive" loading — that produces flicker and broken partial UI.
- For lists/tables, render N skeleton rows matching the expected row shape instead of one blank block.

---

## 2. Backend — Object-Oriented Programming (not functional style)

All server-side code (`app/api/**`, `lib/**`) uses **OOP with classes**. Do not introduce new module-level function-based modules for domain logic.

### 2.1 Class-Based Services

- Each domain concept is a **class** with a single responsibility: `FlowEngine`, `FlowPoller`, `WorktreeManager`, `SecretStore`, etc.
- Services hold their dependencies (db handle, config, clients) as **constructor-injected private fields** — no module-level mutable singletons except through a documented singleton factory (`lib/singleton.ts` pattern).

```ts
// ❌ Bad: loose functions + module-level mutable state
let cache = new Map();
export function getFlow(id: string) { ... }
export function createFlow(...) { ... }

// ✅ Good: encapsulated class
export class FlowService {
  constructor(
    private readonly db: Database,
    private readonly cache: FlowCache,
  ) {}

  get(id: FlowId): Flow { ... }
  create(input: CreateFlowInput): FlowId { ... }
}
```

### 2.2 Conventions

- **Encapsulation:** private/readonly fields; expose behavior methods, not raw data. Getters only when a real consumer exists.
- **Composition over inheritance.** Use small collaborator classes; `abstract` base classes only for genuine shared polymorphic behavior (see `lib/engine/nodes/base`).
- **Interfaces for boundaries:** define an interface per external port (task providers, node registry, git host integrations) and depend on the interface, not the concrete class. Follow the existing `lib/engine/tasks/task-provider.ts` and `lib/engine/ports/` patterns.
- **Factories/registries over `switch` on type strings:** new node/task kinds register into the existing registries (`lib/engine/nodes/registry.ts`, `lib/engine/tasks/registry.ts`) instead of adding branches.
- **One class per file**, file named after the class in kebab-case (`flow-poller.ts` → `FlowPoller`).
- **Errors:** throw typed error classes; API routes catch and map to HTTP responses.
- **No logic in route handlers:** `app/api/**/route.ts` files only parse/validate input, call a service class method, and serialize the response. All business logic lives in `lib/` classes.

### 2.3 Migrating Legacy Functional Code

When touching an existing function-based module in `lib/`:
- If it has module-level mutable state → convert to a class with those as instance fields.
- If it's a cohesive set of 3+ related functions → group them into a service class.
- If it's a small pure utility (`format.ts`, `utils.ts`) → it may stay functional; pure helpers are fine.
- Do not do a drive-by rewrite of untouched code; refactor what your task touches, incrementally.

---

## 3. Project Commands

```bash
npm run dev          # dev server
npm run build        # production build (must pass before finishing a task)
npm run lint         # eslint
npm run seed:demo    # seed demo data (variants: :reset, fanout, branch-refine, custom)
```

---

## 4. Workflow Rules for Agents

1. **Read before writing.** Check how neighboring files solve the same problem; follow existing patterns over generic preferences.
2. **TypeScript strict.** No `any`, no non-null `!` assertions on possibly-missing data — validate at boundaries.
3. **Never edit `components/ui/`** (shadcn primitives) unless the task explicitly requires it.
4. **Run `npm run build` and `npm run lint`** after changes; both must pass.
5. **DB changes:** schema lives in `lib/db/schema.sql`; coordinate row mappers in `lib/db/rows.ts`.
6. **Secrets/env:** only via `lib/config.ts`; never hardcode, never commit `.env`.
7. Keep diffs focused: no unrelated reformatting, no drive-by renames.
