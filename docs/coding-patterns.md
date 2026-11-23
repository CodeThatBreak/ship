# DevFlow coding patterns

Concrete recipes for writing code in this repo. [AGENTS.md](../AGENTS.md) holds the rules. This doc shows how to follow them for the problems DevFlow actually has: a long-running flow engine with a node state machine, background agent runs, git side effects, Postgres (Prisma), and a polling React UI.

Some primitives are marked **(added in Task NN)** with a link to the task in [`docs/review-tasks/`](review-tasks/README.md) that introduced them — those tasks have landed; the links are provenance, not TODOs.

**Reference implementations to copy from:**

| Concern | Reference |
| --- | --- |
| Backend node kind layout | `lib/engine/nodes/kinds/plan/` (thin orchestrator, collaborators, `constants/`, `types/`, co-located tests) |
| Node persistence seam | `lib/engine/nodes/shared/node-support.ts` (nodes never import `db`; the lint rule enforces it) |
| Frontend feature layout | `components/flows/components/plan/` (`components/`, `hooks/`, `constants/`, `types/`, `utils/`, `reducer/`, barrel `index.ts`) |
| Throwing fetch helpers | `hooks/fetch-json.ts` (`fetchJson`, `postJson`, `errorMessageOf`) |
| Query keys | `constants/query-keys.ts` |
| Domain constants | `constants/flow.ts` (`FLOW_STATUS` + derived type), `lib/engine/constants/` |
| Process-bound services | `lib/composition/processServices.ts` (`pinnedProcessService`) |

---

## 1. Principles

1. **Current flow only.** Don't add shims, normalizers, fallbacks or migrations for legacy or deprecated data shapes. If old data shows up, fail loudly with a typed error. Delete legacy code when you find it (Tasks [07](review-tasks/07-remove-dead-and-legacy-code.md) and [08](review-tasks/08-db-bootstrap-and-schema.md)).
2. **Fail loudly, early.** Validate at the boundary, guard at the top of the function, throw a typed error. Never turn an error into `null`, `[]`, `{}` or "still running".
3. **One owner per thing.** One writer per terminal node status, one `queryFn` per query key, one serializer per payload, one constant per domain value, one wrapper per external tool (git, HTTP).
4. **Atomic or nothing.** A multi-statement write is one transaction. A state transition is one conditional `UPDATE` whose `changes` you check.
5. **Every promise is awaited or explicitly handed to the background helper.** No bare `void promise`.
6. **Small units.** About 200 lines per component file and about 400 per backend class. When you have to describe a unit with "and", split it.

## 2. Code style

- **Named exports only.** Default exports are allowed only where Next.js requires them (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`).
- **Arrow functions** for components, hooks, helpers and route handlers (`export const POST = async (req: Request) => { … }`). Class methods stay methods.
- **File naming** follows AGENTS.md section 2.9 for new files: PascalCase component files, `useThing.ts` hooks, camelCase utils, lowercase folders. Backend classes go one per file, in kebab-case (`flow-poller.ts` exports `FlowPoller`). The existing kebab-case hook files (`use-flow-chat.ts`) are migrated in [Task 54](review-tasks/54-feature-layout-and-naming.md). Don't rename them in unrelated PRs.
- **No `any`, no `!` on data that may be missing, no `as unknown as`.** Narrow with Zod, type guards or an early `throw`.
- **Comments state constraints the code can't show.** Don't narrate the code.

---

## 3. Backend

### 3.1 Layers

```text
app/api/**/route.ts      parse input (Zod) -> call ONE service method -> serialize (or map error)
loaders/*.ts             same as routes, for Server Components
lib/<domain>/*-service.ts   domain logic, classes, constructor-injected deps
lib/<domain>/*-store.ts     SQL for one table family, reads through lib/db/rows.ts mappers
lib/db                   connection, transaction(), schema, row mappers

lib/engine/nodes/**      node kinds -> NodeSupport (the only node-side persistence seam)
lib/engine/runtime/**    orchestrators (poller, reconciler) -> stores
```

- Routes and loaders never run SQL and never hold domain logic. If a route and a loader need the same payload, it comes from one service method.
- Services depend on stores and ports (interfaces in `lib/engine/ports/`), never on a concrete integration module singleton.
- A route that touches the DB declares `export const runtime = "nodejs"` (lint-enforced after [Task 03](review-tasks/03-lint-rule-hardening.md)).

### 3.2 Route handler recipe

```ts
import { z } from "zod";
import { parseJson } from "@/lib/http/parse";        // added in Task 10
import { toErrorResponse } from "@/lib/errors";      // added in Task 09
import { flowEngine } from "@/lib/engine/flowEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChatBody = z.object({
  nodeKey: z.string().min(1),
  content: z.string().min(1),
  model: z.string().min(1).optional(),
});

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await parseJson(req, ChatBody);
    await flowEngine.sendChat(id, body);
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
};
```

- The action route is one `z.discriminatedUnion("action", [...])`. Each action name comes from a `FLOW_ACTION` constant shared with the client.
- Query params go through `z.coerce` schemas with bounds (`limit: z.coerce.number().int().min(1).max(500).default(200)`).
- The schema lives next to the route, or in `lib/schemas/` when the client form and the server both need it. Types are `z.infer`, never hand-written twins.

### 3.3 Typed errors (added in [Task 09](review-tasks/09-typed-errors.md))

```ts
// lib/errors.ts
export const ERROR_CODE = {
  INVALID_INPUT: "invalid_input",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  UPSTREAM: "upstream_error",
} as const;
export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export class DomainError extends Error {
  constructor(message: string, readonly status: number, readonly code: ErrorCode) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends DomainError {
  constructor(message: string) { super(message, 400, ERROR_CODE.INVALID_INPUT); }
}
export class NotFoundError extends DomainError {
  constructor(what: string, id: string) { super(`${what} ${id} not found`, 404, ERROR_CODE.NOT_FOUND); }
}
export class ConflictError extends DomainError {
  constructor(message: string) { super(message, 409, ERROR_CODE.CONFLICT); }
}
export class UpstreamError extends DomainError {
  constructor(message: string, readonly upstreamStatus?: number) { super(message, 502, ERROR_CODE.UPSTREAM); }
}

export const toErrorResponse = (e: unknown): Response => {
  if (e instanceof DomainError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  console.error("[api] unhandled error", e);
  return Response.json({ error: "Internal error" }, { status: 500 });
};
```

- The engine throws `NotFoundError` for a missing flow, node or template, and `ConflictError` for "already running", "not awaiting approval" or "merge in progress".
- Integrations throw subclasses of `UpstreamError` (for example `GitHostApiError { status, path, retryAfterMs }`). Response bodies are truncated, and tokens are redacted before they reach a message.
- Never put a raw upstream body, git stderr or a URL containing credentials into an error message, an event or a DB column.

### 3.4 Validation of everything that crosses a boundary

| Boundary | Where it's checked |
| --- | --- |
| Request body and query | Route, via `parseJson` / `parseQuery` |
| Webhook payloads | Zod schema in the integration's `parseWebhook`, after signature verification |
| Node config | `configSchema.parse` at the top of `run()`/`turn()` and in `setNodeConfig`. An invalid config fails the node with a readable message and never silently falls back to catalog defaults |
| Persisted JSON (artifact meta, events, trigger payloads) | Row mapper in `lib/db/rows.ts`, `safeParse` raising `RowDecodeError` with table, column and id |
| Agent output | The agent-output pipeline (`AgentOutputPipeline` — contract validation + bounded feedback retry; §3.13) |
| Env | `lib/config.ts` only |

### 3.5 Persistence

- **Stores own queries.** One class per table family (`NodeStore`, `CommentStore`, `PlanStepStore`), all persistence through the Prisma query API — ORM-first. Raw SQL survives ONLY in the containment list (`docs/orm-migration/README.md`): sites whose Postgres invariant the ORM cannot express (SKIP LOCKED atomic claims, DB-clock interval arithmetic, the transition authority's attempt-fenced CAS, advisory locks, COALESCE partial updates) — each entry justified by that invariant and enforced by `tests/architecture/noRawSqlOutsideContainment.test.ts` plus the lib-scoped ESLint rule. Engine orchestrators call store methods, not `db.get`/`db.all`.
- **Bind constants as parameters.** Tagged templates (`prisma.$executeRaw\`WHERE status = ${FLOW_STATUS.RUNNING}\``) or positional `$1, $2, …` params — never interpolate a literal into a SQL string.
- **"Latest" means `ORDER BY`.** Any "latest/newest" read has an explicit `ORDER BY … DESC` and a test with more than one row (see CR-270).
- **Transactions** are async Prisma interactive transactions ([Task 12](review-tasks/12-db-transactions.md), carried over to step 01):

  ```ts
  // Database
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((inner) => fn(inner));
  }

  // caller
  await this.db.transaction(async (tx) => {
    await this.flows.insert(flow, tx);
    await this.nodes.insertSnapshots(flow.id, graph, tx);
  });
  ```

  The callback may `await` DB work only. Do the async I/O (git, HTTP, agent
  calls) before or after, and keep the transaction to DB writes — same
  discipline as the synchronous era, now enforced by the callback's types.
- **Row counts over `.changes`.** A conditional `UPDATE … WHERE …` (claim,
  attempt-fenced terminal write) checks the affected-row count returned by
  `$executeRaw`/`updateMany` — `0` means lost race, `1` means claimed.
- **External-I/O sequences journal through the `jobs` table** (Invariant 7):
  insert the job write-ahead (`dedupKey`, `runAt`), claim it atomically
  (`UPDATE … SET status='claimed', lease_until=… WHERE id=? AND
  status='queued'` — `FOR UPDATE SKIP LOCKED`), do the host work, mark
  done/failed. A crash leaves a leased job whose lease expires → the worker
  sweep re-claims or flags it. Applies to webhook deliveries, schedule fires,
  MR creation, cancels (dedup keys are freed on terminal so a retry can
  re-enqueue).
- **Schema changes** go through Prisma migrations (`prisma/schema.prisma` +
  `prisma migrate dev`). Ask before changing the schema, keep
  `lib/db/rows.ts` (JSONB payload validators) in the same PR, and remember
  enum values are sticky (adding values is easy, removing is not). Model
  fields are camelCase with explicit `@map("snake_case")` columns (Q11);
  the DB stays snake_case.
- **Secrets** are read only through a `SecretStore`. List queries never
  select token columns (`rows.ts` `.omit({ token: true })`).

### 3.6 Node state machine and the transition authority

The `TransitionAuthority` (`lib/engine/runtime/transitions/nodeTransitions.ts`)
is the ONLY writer of `nodes.status` / `attempt_id` (Invariant 1). The declared
transition table (`runtime/transitions/constants/transitionTable.ts`) is the
entire legal edge set — anything not listed there is a bug the tests reject.

- **Every status write goes through the authority.** `claim` (atomic claim from
  a declared from-set; stamps `attempt_id` + `lease_until`, clears
  `wait_until`), `publishOutcome` / `publishAggregate` (terminal, attempt-
  fenced, output-validated), `apply` / `applyFlowScope` for the rest. The
  arch test rejects a raw status write, and `NodeSupport.setNode` refuses
  `status`/`attempt_id` keys at runtime.
- **Triggers funnel through the TriggerGateway** (`runtime/triggers/`): run,
  retry, chat, approve, webhook resume, wait/schedule fires — every path
  claims through it. The loser of the atomic claim emits one typed
  `skipped_duplicate_trigger` event and returns `{ started: false }` — no
  silent-return-vs-throw split.
- **Adding a legal transition:**
  1. Add a row to the transition table (`from` set → `to` set, actor) in
     `runtime/transitions/constants/transitionTable.ts`.
  2. If the actor is new, add it to the vocabulary in
     `runtime/transitions/types/transitions.ts`.
  3. Emit a typed event for the transition via `TransitionEvents` (new kind in
     `EVENT_KIND` + the client mirror in `constants/events.ts`).
  4. Write it through the authority's methods — never a direct Prisma status
     write. The transition-table arch test pins the table.
- **A terminal write is one atomic batch**: the validated output, the
  lifecycle event and the artifact save land in the same transaction
  (`applyOutcome` → §3.5). A crash between them leaves no partial state.
- **`recover()` returns a `RecoveryResult`** — `{ kind: "recovered" } |
  { kind: "manual", reason }` (`nodes/shared/types/recovery.ts`) — and never
  throws. The single try/catch lives at the recovery seam
  (`RecoveryDriver` via the engine's `completeNodeFromResult`); a throw maps
  to `manual` + an error event, once.
- **Status vocabulary** comes from the predicate sets in
  `runtime/transitions/constants/statusSets.ts`. Never inline
  `status === "done" || status === "approved"`.
- **Chat-only turns don't own the node.** They must not run through code paths
  that can set the node to `failed`.

### 3.6.1 Contracts (`consumes` / `outputSchema`)

Every node kind declares what it needs and what it publishes
(`lib/engine/runtime/contractPipeline.ts`, Invariant 5):

- **Stage start — `consumes`** (default `z.object({})` on `NodeDefinition`):
  the materialized input map is validated before the def runs. A miss is a
  typed `InputContractError` (`{nodeKey, missingField, producerKey}`) → the
  stage fails with an `input_contract_violation` event. Refuse-to-proceed is
  the default; never silently pass an empty input. Declarative kinds declare
  their needs through the template node's `input_map` targets, validated at
  the same seam (a mapped expression resolving to nothing fails loudly).
- **Stage end — `outputSchema`**: the terminal write validates the published
  output. A miss is a typed `OutputContractError` + an `output_contract_violation`
  event — the node fails, nothing unvalidated is ever published. Failed/skipped
  terminals are exempt (the violation detail travels in the event, not the
  output column).
- **Declarative configs author contracts in Zod**; `z.toJSONSchema()` produces
  the agent-facing directive, and raw JSON Schema configs convert at the
  boundary via `zod-from-json-schema` (`lib/engine/templates/jsonSchemaToZod.ts`).
- **Edge/loop conditions** referencing `nodes.<key>.output.<field>` are
  lint-checked at template save/validate against the producing node's schema
  (`lib/jsonata/nodeOutputRefs.ts` + `templateLint.ts`).

### 3.7 Background work and promises

- Fire-and-forget work goes through one helper that logs, records the failure against the right node (when it owns one), and is awaitable in tests:

  ```ts
  // FlowEngine (or a small BackgroundRunner)
  runInBackground(label: string, owner: { flowId: string; nodeKey: string | null }, work: () => Promise<void>): void
  ```
- Never write `void somePromise()` or call an `async` function through an interface typed `void`. Interface methods that do async work return `Promise<void>`, and callers `await` them.
- Long-lived loops (poller, pipeline gate) have a re-entrancy guard and a try/catch around each phase, and they schedule the next tick with `setTimeout` after the current one finishes.
- `@typescript-eslint/no-floating-promises` is enabled for `lib/**` ([Task 03](review-tasks/03-lint-rule-hardening.md)).

### 3.8 Process state

- **Composition-root rule (decision Q9).** Services are constructed in one of three composition roots in `lib/composition/` — never as ad-hoc globalThis pins:
  - **Request container** (`container.ts` → `createContainer(prisma)`): stateless, DB-fenced services. Routes, loaders and server components get services from here.
  - **Engine wiring** (`container.ts` → `engineParts`): the engine cluster's collaborators, wired once and exported as a plain module const. Every part is stateless or DB-fenced, so per-module-graph copies cannot disagree.
  - **Process-services container** (`processServices.ts` → `pinnedProcessService(key, create)`): the ONLY home for genuinely process-bound in-memory state — run handles, mutexes, live-feed buffers, coalescing maps whose per-module-graph copies would diverge (e.g. `cursorAgent`, `localAgent`, `worktrees`, `worktreeManager`, `liveTaskFeed`). The defining module pins its own export, keeping the import graph unchanged. Never register a stateless service here.
- The DB client (`lib/db/prismaClient.ts`) is the only other process-pinned service (its connection pool must survive HMR, pinned inline under `Symbol.for("devflow.singleton.prisma")`). The arch test `tests/architecture/noProcessSingletonOutsideDb.test.ts` enforces that nothing else pins process state.
- In-memory state is a cache, never the source of truth. Anything that must survive a restart (wait deadlines, job leases) is persisted, and the poller re-arms it on start.
- Maps are bounded (size cap or TTL sweep) and pruned when a flow is deleted or finishes.
- Locks are keyed by the resource they protect. If the directory is per parent flow, the lock is per parent flow.

### 3.9 Outbound I/O (git, HTTP, agents)

- **One wrapper per tool.** Git runs through one `GitRunner` (timeout, max buffer, redaction, typed `GitError`), and HTTP to git hosts through one client method (`AbortSignal.timeout`, typed errors, bounded retry with `Retry-After` for idempotent GETs, `paginate<T>()` for lists).
- **Every call has a timeout**, from a named module constant.
- **Credentials never go in URLs or argv.** Pass them out of band (`GIT_ASKPASS`, `http.extraHeader` via `GIT_CONFIG_*`, request headers).
- **Child processes** get an explicit env (`extendEnv: false`), run in their own process group, and are killed as a group on timeout or abort.
- **Agent ports** return discriminated results (`running | done | unavailable`) instead of `null`, and every created run handle is released in a `finally`.

### 3.10 Constants

| Kind | Location |
| --- | --- |
| Client-safe shared values (statuses, actions, event types, execution modes, query keys) | `constants/<domain>.ts` |
| Server-only engine values (node keys, trigger sources, declarative kinds) | `lib/engine/constants/` |
| Values of one node kind or feature | That kind's or feature's `constants/` folder, named files per domain (`constants/waiting.ts` — never an `index.ts` barrel, AGENTS §2.3) |
| A value used by a backend class | The owning feature's `constants/` folder — a class file stays pure (§12): no module-level constants parked inside it |

Always use an `as const` object plus a derived union type. Before adding a value, search for an existing one (`rg '"awaiting_approval"'`).

### 3.11 Node kind layout

```text
lib/engine/nodes/kinds/<kind>/
  <kind>-node.ts        thin orchestrator: run / turn / chat / recover / previewPrompt
  <kind>-store.ts       persistence for this kind, through NodeSupport
  <kind>-contract.ts    output parsing and validation
  <kind>-prompt.ts      prompt assembly (shared by run and previewPrompt, so the preview can't drift)
  schema.ts             config and output Zod schemas
  constants/ types/     named files, no barrels (`constants/waiting.ts`, `types/gateProgress.ts`)
  *.test.ts             co-located
  index.ts              registration only
```

- New kinds register in `lib/engine/nodes/registry.ts`. Don't add `switch (kind)` branches anywhere.
- Declarative kinds share one `DeclarativeNode<Def>` base (config parsing, approval hold, description), added in [Task 49](review-tasks/49-node-kind-structure.md).
- `previewPrompt` and `run` call the same builder. A test asserts the preview equals the sent prompt for a fixture.

### 3.12 The effects registry (post-terminal sequencing)

"What happens after Y finishes" is registered data, not call-site chaining
(`lib/engine/runtime/effects/`, Invariant 8).

- **Register `NodeEffects` at engine boot** — the FlowEngine constructor's
  registry dispatch, keyed by `(defKey, lifecycle)` over the four declared
  lifecycles (`afterSuccess | afterFailure | afterApproval | loopReentry`,
  `constants/effectLifecycles.ts`):

  ```ts
  // a runtime or kind module registers its own post-finish behavior
  registry.register(NODE_KEYS.PIPELINE, {
    afterSuccess: async (ctx) => { /* gate green → the edges */ },
  });
  ```

- **Implementations stay in their owning module** (`sdlcEffects.ts` over the
  SDLC chain); the registry never parks sequencing logic. Declarative effects
  register under the wildcard key (`EFFECT_KEY_ANY`) and decide relevance
  themselves from the node's config; built-in kinds register under their
  concrete defKey.
- **Dispatch is centralized**: the StageRunner's `postTerminal` runs
  `afterSuccess` → `loopReentry` → falls through to the default edge walk;
  `afterFailure` never advances; the approval door dispatches `afterApproval`
  on a won approve. Never add a sequencing call site — register an effect
  instead. Unclaimed lifecycles fall through to the template's edge walk
  (the edges stay the stage-ordering data).
- **Effect-driven stage starts claim through the TriggerGateway**, so a lost
  claim emits the same typed skip event a user click would. Never add a
  dispatch path that skips a claim.

### 3.13 The agent-output pipeline

Every agent-emitting node consumes one output path
(`lib/engine/nodes/shared/agentOutput/`, Invariant 6):

```text
agent text → extractJson → validate against the node's contract
           ├─ ok            → typed success event → outcome
           ├─ no_json / schema_mismatch
           │     → output_error envelope → bounded feedback retry (per-node budget)
           │     → exhausted → typed output_contract_violation event → failed
           └─ agent_reported → typed event → failed (never retried)
```

- **A node integrates by running its response through the pipeline with its
  own schema** (`NodeDefinition.retryBudget` is the per-kind knob — default 1;
  review/build validate at 0 and map misses to failed outcomes themselves).
  Never hand-roll a parse/fallback loop beside it.
- **Missing/malformed output is a first-class, distinguishable failure** —
  never a default. Banned by test: `(empty response)` fabrication, `markDone`
  title salvage, empty-pass review, stdout scavenging, `?? {}`/`?? []`
  fallbacks, case-insensitive label salvage. Node kinds differ only in output
  shape, never in fallback language.
- **The retry feedback is one shared builder** (`utils/retryFeedback.ts`); the
  "return JSON" directive is schema-generated (`AgentOutputError.directive`)
  so the advertised schema and the validator cannot drift — first turn and
  retry render the same bytes.

---

## 4. Frontend

### 4.1 Feature layout

```text
components/<feature>/
  index.ts              public barrel, only what other features import
  <Feature>.tsx         container: composes hooks and presentational children
  queries.ts            queryOptions factories for this feature's server data
  components/           presentational subcomponents (props in, JSX out)
  hooks/                useThing.ts: stateful and data logic, mutations
  constants/ types/     named files, no barrels — import the concrete module (AGENTS §2.3)
  utils/                pure TS, no React, no fetching
```

`components/flows/components/plan/` is the reference. Hooks used by one feature live in that feature. `hooks/` at the root is only for hooks with two or more consuming features.

### 4.2 Server first

- Pages are Server Components. Load data in `loaders/*.ts` (which call services), prefetch into a `QueryClient`, and pass it down with `<HydrationBoundary>`. Interactive parts are client islands.
- The server `QueryClient` and the browser one share one defaults constant (CR-179).

### 4.3 Queries: one `queryFn` per key

```ts
// components/flows/queries.ts
import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import type { Artifact } from "@/types/flow";

export const artifactQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.artifacts.detail(id),
    queryFn: () => fetchJson<Artifact>(`/api/artifacts/${id}`),
    staleTime: Infinity, // artifact versions are immutable
  });

// usage
const artifact = useQuery(artifactQuery(id));
```

- Every key in `queryKeys` has exactly one `queryOptions` factory, and every reader (`useQuery`, `fetchQuery`, `prefetchQuery`, SSR seeding) goes through it. Two shapes under one key is the bug behind CR-005, CR-121 and CR-135.
- Fetchers throw. Use `fetchJson`/`postJson` from `@/hooks/fetch-json`. Never `.catch(() => null)`, never return a fallback, never `res.json()` without checking `res.ok`.
- Polling queries keep previous data (`placeholderData: keepPreviousData`) so a background refetch doesn't flash a skeleton. Per-entity queries don't, so switching entities shows the new entity's loading state.
- Accumulating feeds (events) keep the merged, de-duplicated buffer in the query cache, not in component state.

### 4.4 Mutations

One hook per action family, returning the mutation object, so callers can show pending and error states:

```ts
// components/flows/hooks/useNodeAction.ts
export const useNodeAction = (flowId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: FlowActionBody) =>
      postJson<{ ok: true }>(`/api/flows/${flowId}/action`, JSON.stringify(action)),
    onSettled: () => invalidateFlow(queryClient, flowId), // one helper lists every affected key
  });
};

// in a component
const approve = useNodeAction(flowId);
<Button disabled={approve.isPending} onClick={() => approve.mutate({ action: FLOW_ACTION.APPROVE_NODE, nodeKey })}>
  Approve
</Button>
{approve.isError && <InlineError message={errorMessageOf(approve.error)} onRetry={() => approve.reset()} />}
```

- Buttons that trigger mutations are disabled while pending. That is the double-submit guard.
- Errors render next to the action that failed (inside the dialog, not behind it).
- Invalidation for a domain lives in one helper (`invalidateFlow`, `invalidatePrompts`), so a new key can't be forgotten.
- Destructive actions (delete repo, delete instance, clear API key) go through `ConfirmDeleteDialog` with `busy={mutation.isPending}`.

### 4.5 Loading, error, empty

Check the states in this order and return early:

```tsx
export const TaskList = () => {
  const tasks = useQuery(tasksQuery(filters));
  if (tasks.isPending) return <TaskListSkeleton rows={8} />;
  if (tasks.isError) return <InlineError message={errorMessageOf(tasks.error)} onRetry={() => tasks.refetch()} />;
  if (tasks.data.length === 0) return <EmptyHint icon={ListTodo} title="No tasks match the current filters" />;
  return <TaskTable rows={tasks.data} />;
};
```

The skeleton mirrors the real layout and lives next to the real component. Shared versions (`RouteError`, `TableSkeleton`, `EmptyHint`, `InlineError`) live in `components/shared/` (added in [Task 52](review-tasks/52-shared-ui-components.md)).

### 4.6 Per-entity state and effects

- **Key by entity.** A component with local state about "the current node, template or repo" is rendered with `key={entity.id}`, so its state resets when the entity changes (`<NodePanel key={node.node_key} … />`). Otherwise state leaks between nodes (CR-028, CR-124).
- **Derive, don't sync.** Store only the user's override and derive the rest (`const selected = override ?? proposed`). Don't copy props or query data into state with an effect.
- **Never emit `onChange` from mount or effects.** Controlled editors call `onChange` only from user input handlers. If the value equals the effective default, don't write it. Opening a tab must never dirty a draft (CR-033).
- **Editable text over structured values** (JSON, numbers, key/value) keeps a local string buffer, and commits a parsed value on blur or when the text is valid.
- **Updaters for batched edits.** Draft mutations take `(current) => next`, never a value built from a render-captured snapshot.
- Read browser-only values (`window`, `Date.now()`, locale formatting) after mount, not during render, because the page is server-rendered.

### 4.7 Lists

- Keys are stable ids (event id, step id, or a client id created when a draft row is created), never the array index.
- Rows are components that take primitives plus a stable `(id) => void` callback. Don't create closures inside `.map()`.

### 4.8 Shared components

- Before writing a component, search `components/ui/` (shadcn primitives, don't edit) and `components/shared/`.
- Promote a component to `components/shared/` on its second consumer, with a domain-neutral name and props.
- `components/shared/` has no domain strings, routes or feature hooks. App-shell pieces (the sidebar and its routes) live in their own folder.
- Use one `cn()` (CR-259).

### 4.9 Accessibility

- Anything clickable is a `<button type="button">` (or uses `render={<button …/>}` on Base UI primitives), with an `aria-label` when it shows only an icon.
- Don't nest interactive elements (button inside button, button inside link).
- Tabs use the `Tabs` primitive, sortable headers set `aria-sort`, and form controls have a `<label htmlFor>`.
- Never intercept Tab. Autocomplete opens on typing or ArrowDown, not on focus.

---

## 5. Tests

- **Where:** co-located `*.test.ts` next to the module for `lib/` (Vitest, `npm test`). UI logic that can be pulled out (reducers, `utils/`, hooks with injected fetchers) gets tests under the feature or in `tests/`.
- **What must have tests:** every service, store and row mapper (AGENTS.md DoD), every state-machine transition you touch, and every bug fix. Write the failing test first.
- **DB tests** run against the Postgres test database (`devflow_test`, dockerized via `npm run db:up`) through the shared harness (`tests/helpers/testDatabase.ts`, `tests/globalSetup.ts`). Never use the dev DB.
- **"Latest", ordering and idempotency** tests always use at least two rows or two calls.
- **Fixtures:** every `docs/flow-templates/*.yaml` is imported by a test, so the fixtures can't rot.
- Vitest doesn't type-check, so `npm run typecheck` is part of the gate.

## 6. Before opening a PR

- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass.
- [ ] No new `any`, `!`, `as unknown as`, `eslint-disable` or `void promise`.
- [ ] New domain strings are constants. New query keys have one `queryOptions` factory.
- [ ] Every async UI has loading, error and empty states. Every mutation shows pending and error.
- [ ] Multi-statement writes are in a transaction. State transitions are conditional updates.
- [ ] No legacy shim added. Legacy code you touched is deleted.
- [ ] If the work closes review findings, their status in [`docs/code-review.md`](code-review.md) and the task checkbox in [`docs/review-tasks/README.md`](review-tasks/README.md) are updated.

## 7. Engine module design (target-architecture §12)

New `lib/engine/**` code lands in the target layout — [`docs/engine-overhaul/target-architecture.md`](engine-overhaul/target-architecture.md) §12 is the source of truth; the recipes here defer to it.

- **Class files are pure.** A file that exports a class exports only that class — no module-scope functions, constants, schemas or types parked at its edges. Constants go to `constants/` named files, Zod schemas to `schema.ts`/`schemas/`, types to `types/`, pure helpers to `utils/` (enforced by `tests/architecture/classFilePurity.test.ts` and `oneClassPerFile.test.ts`).
- **Every exported class carries a JSDoc header** directly above the declaration: its role in the mental model, the invariant(s) it upholds, and what it must never do (enforced by `tests/architecture/engineClassHeaderDoc.test.ts`).
- **Casing** follows AGENTS §2.9 (lint-enforced): camelCase variables/functions/methods, SCREAMING_SNAKE_CASE for true constants only, PascalCase type-likes; Prisma fields camelCase with `@map` columns (`tests/architecture/prismaSchemaCasing.test.ts`).
