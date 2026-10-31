---
status: current
supersedes_partially:
  - docs/architecture/plan-node.md
  - docs/plan-conversation-refine.md
  - docs/branch-scoped-refine.md
owner: engine+flows
last_updated: 2026-10-31
---

# Plan node — unified turns (implementation design)

## Summary

Replace the plan node’s **three send paths** (`run_node` bootstrap, `POST /chat` + `PlanFollowUp`, `refine_plan` + `SubPlanResponse`) with **one user-facing send** and **one engine turn handler**. Routing depends only on:

1. Whether a plan artifact exists yet (selects **prompt assembly** and **node status** transitions only—not apply rules).
2. Whether the send carries a **branch ref** (chat `thread` = branch name; requires an existing plan with that branch).

Agent sessions: **main plan** uses the node’s primary agent cursor; **each branch** keeps its own agent id and resumes when present.

Parsing and apply: **one turn envelope** (`reply` + optional payload). Main / pre-publish turns use optional **`plan`** (`PlanResponse`). Branch turns use optional **`subPlan`** or **`subPlanPatch`** only—never a full master plan re-emit. Reply-only turns omit both payloads.

---

## Goals

| Goal | Detail |
|------|--------|
| One composer send target | No `run_node` / `refine_plan` forks in `usePlanComposer`; plan chat always `POST /api/flows/:id/chat` (or a thin alias that still lands in the same handler). |
| One engine entry | `PlanNode.turn()` (name TBD) replaces separate `run()` whole/chat/scoped branches and deletes `PlanNode.chat()` override. |
| One turn envelope | One JSON shape for every harness turn: `reply` + optional payload. Whole/pre-publish advertise **`PlanResponse`** inside `plan`; branch turns advertise **`SubPlanResponse`** / **`SubPlanPatch`** inside `subPlan` / `subPlanPatch` (see schema). Remove `PlanFollowUp` and `parseFollowUp`. |
| Per-branch agent continuity | Branch thread: `followUpOn = output.branchAgents[branch]` if set, else fresh agent; persist new id after successful turn. |
| Cleaner UI | `usePlanComposer` passes `thread` only; no `sendMutationFn` override for pending state. |

## Non-goals (this iteration)

- Changing checklist editing, approve footer, split/fan-out, or build consumption.
- Template editor / `prompt_body` / `prompt_rules` knobs (still apply on every turn’s prompt assembly).
- StepFlowManager / per-checklist-step child flows.
- Rewriting prompt copy in `prompt-defaults` beyond contract/schema references.

---

## User-visible behavior

### Rule 1 — No plan artifact yet (pre-publish conversation)

- **Condition:** Latest plan artifact count = 0 (node stays **`pending`** until a turn publishes `plan`).
- **Send:** Main thread only. Composer may open **prefilled** with the plan template body (`GET /prompt?node=plan`); after the first send the draft behaves like normal conversation (empty + per-thread stash).
- **Effect:** Engine runs **pre-publish turn**: bootstrap-oriented prompt assembly (see Prompts), agent session same as whole turns (`followUpOn = null` on first harness run, then resume node agent).
- **Apply (same as rules 2 & 3):** If output includes **`plan`** → validate, publish **v1**, sync checklist, node → **`awaiting_approval`**. If **`plan` omitted/null** → **reply only**; no artifact, node stays **`pending`**, user can continue the conversation.

### Rule 2 — Plan exists, no branch ref

- **Condition:** Artifact exists; `thread` absent or main tab id.
- **Send:** User message on main conversation.
- **Effect:** Engine runs **whole turn**: live-plan prompt assembly (`plan_refine`-style), `followUpOn = node.agent_id ?? lastAgentId(node.id)`.
- **Apply:** If output includes **`plan`** → new artifact version (whole plan). If **`plan` omitted/null** → **reply only**; no version, checklist unchanged, status unchanged (typically remains **`awaiting_approval`**).

### Rule 3 — Plan exists, branch ref set

- **Condition:** Artifact exists; `thread` = branch name (must exist on latest plan meta).
- **Send:** User message on branch tab.
- **Effect:** Engine runs **branch turn**: branch-scoped prompt (context locked to that branch),  
  `followUpOn = node.output.branchAgents[branch] ?? null` (fresh if never refined).
- **Apply:** If output includes **`subPlan`** (full branch document) or **`subPlanPatch`** (delta) → validate, **deterministic merge** into latest plan meta via `BranchRefinement` (master artifact markdown unchanged; branch `markdown` + checklist rows for that branch updated) → new artifact version, `scopedRefine` + `refinedFrom.source: branch`. If both payloads absent/null → **reply only** on branch thread.  
  **`plan` must not appear on branch turns** — reject or bounded-retry with directive feedback (returning a whole plan wastes tokens and risks cross-branch drift).

Invalid branch name: **400** on send (UI invalidates branch tab); no silent whole-plan fallback.

### Apply rules (by turn kind)

| Turn kind | Publish payload | Artifact effect |
|-----------|-----------------|-----------------|
| Pre-publish / whole (rules 1–2) | `plan` → `PlanResponse` | New version (v1 or bump); master markdown + full meta |
| Pre-publish / whole | reply only | None |
| Branch (rule 3) | `subPlan` → full **`SubPlanResponse`** | Merge branch steps + `branches[].markdown`; master doc unchanged |
| Branch (rule 3) | `subPlanPatch` → **`SubPlanPatch`** | Apply delta only (see merge rules); master doc unchanged |
| Branch (rule 3) | reply only | None |

Reply-only semantics are identical everywhere: no artifact write; agent session still advances for follow-up.

There is **no** “first turn must include a publish payload” rule on the main thread. Branch turns likewise may clarify before sending `subPlan` / `subPlanPatch`.

---

## Unified output contract

### Schema (canonical envelope)

One **envelope** for all turns; the **payload key** depends on turn kind (enforced at apply time):

```ts
/** Every plan-mode agent turn. */
export const PlanTurnOutput = z
  .object({
    reply: z.string().min(1),
    /** Whole / pre-publish publishes only. */
    plan: PlanResponse.nullish(),
    /** Branch publish: full rewrite of THIS branch's sub-plan (markdown + all branch steps). */
    subPlan: SubPlanResponse.nullish(),
    /** Branch publish: change-only delta (preferred for iterative refines). */
    subPlanPatch: SubPlanPatch.nullish(),
  })
  .superRefine((val, ctx) => {
    const publishKeys = [val.plan, val.subPlan, val.subPlanPatch].filter(p => p != null);
    if (publishKeys.length > 1) {
      ctx.addIssue({ code: "custom", message: "use at most one of plan, subPlan, subPlanPatch" });
    }
  });
```

**`PlanResponse`** — unchanged (master plan: markdown, steps, optional branches, execution fields).

**`SubPlanResponse`** — unchanged today (`markdown` + `steps` for **one** branch). Engine sets `step.branch` on merge. Use when the agent rewrites the entire branch sub-plan (first branch doc, or large reshuffle).

**`SubPlanPatch`** — new; agent sends **only what changed**:

```ts
export const SubPlanPatch = z
  .object({
    /** When present: replaces `branches[].markdown` for the ref'd branch only. */
    markdown: z.string().min(1).optional(),
    /** Steps to add or replace, matched by `id` within the branch. Omitted steps stay as-is. */
    upsertSteps: z.array(PlanStep).min(1).optional(),
    /** Step ids to drop from this branch only. */
    removeStepIds: z.array(z.string()).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.markdown && !val.upsertSteps?.length && !val.removeStepIds?.length) {
      ctx.addIssue({ code: "custom", message: "subPlanPatch must include at least one change" });
    }
  });
```

**Merge (deterministic, server-side):**

- **`subPlan`:** existing `BranchRefinement.merge(meta, branchName, sub)` — other branches and master markdown untouched.
- **`subPlanPatch`:** extend `BranchRefinement` with `applyPatch(meta, branchName, patch)` — remove ids, upsert by id within branch, optional markdown replace; never mutates other branches’ step objects (same reference stability guarantees as today).

**Prompt JSON Schema by turn kind:**

| Turn | Advertised payload in locked contract block |
|------|---------------------------------------------|
| Pre-publish / whole | `PlanTurnOutput` with **`plan`** only (`subPlan*` omitted from directive example) |
| Branch | `PlanTurnOutput` with **`subPlanPatch` preferred**, **`subPlan`** for full rewrites; explicitly forbid **`plan`** |

Remove `PlanFollowUp` as a separate type (its shape is subsumed by `PlanTurnOutput`). Keep `SUB_PLAN_RESPONSE_JSON_SCHEMA`; add `SUB_PLAN_PATCH_JSON_SCHEMA`.

The agent must return **one JSON object** (optionally fenced in a markdown code block; the engine uses the same `extractJson` helper as today). The **`reply`** field is what users see in the chat rail. Publish fields depend on turn kind (`plan` vs `subPlan` / `subPlanPatch`).

### Example agent outputs (by scenario)

Illustrative payloads only—field content is abbreviated where obvious. When `plan` is omitted, it may also be sent as `"plan": null` (same effect).

#### A — Pre-publish, reply only (Rule 1)

User sent the prefilled template or a short “start planning” message. Agent needs more context before committing to a checklist.

**Engine:** log `reply`; node stays `pending`; no artifact.

```json
{
  "reply": "Before I draft the plan: should we treat the migration as a big-bang cutover or run old and new APIs in parallel for one release?"
}
```

#### B — Pre-publish, first plan version (Rule 1 → v1)

User answered the clarifying question (or gave enough detail in one shot). Agent publishes the first artifact.

**Engine:** validate `plan` → artifact **v1**, sync `plan_steps`, node → `awaiting_approval`; chat shows `reply`.

```json
{
  "reply": "Here is a first pass: parallel run for one release, then remove the legacy path in a follow-up MR.",
  "plan": {
    "markdown": "# Implementation plan\n\nRun dual-write for one release, then delete legacy handlers.\n",
    "steps": [
      {
        "title": "Add feature flag and dual-write path",
        "detail": "Gate new storage behind `PLAN_DUAL_WRITE`.",
        "files": ["lib/sync/dual-write.ts"],
        "branch": null
      },
      {
        "title": "Remove legacy path after soak",
        "detail": "Drop flag default-on and delete old module.",
        "files": ["lib/sync/legacy.ts"],
        "branch": null
      }
    ]
  }
}
```

#### C — Whole plan, reply only (Rule 2)

Plan v1+ exists. User asks about a step; agent answers without changing the document.

**Engine:** log `reply` only; version unchanged.

```json
{
  "reply": "Step 2 assumes we keep the legacy module for one release only—the checklist already says to delete it in the follow-up MR; we are not keeping it long-term."
}
```

#### D — Whole plan, new version (Rule 2 → vN+1)

User asks for a substantive change on the main thread. Agent re-emits a **full** `PlanResponse` (not a delta).

**Engine:** new artifact version; `refinedFrom.source: chat`; approval re-gates if applicable.

```json
{
  "reply": "Updated the plan to add an observability step and split the migration into two MRs.",
  "plan": {
    "markdown": "# Implementation plan\n\n…updated master document…\n",
    "steps": [
      {
        "id": "s1",
        "title": "Add feature flag and dual-write path",
        "detail": "…",
        "files": ["lib/sync/dual-write.ts"],
        "branch": null
      },
      {
        "title": "Add metrics and dashboards for dual-write",
        "detail": "Counter for shadow mismatches; dashboard link in runbook.",
        "files": ["lib/metrics/dual-write.ts"],
        "branch": null
      },
      {
        "title": "Remove legacy path after soak",
        "detail": "…",
        "files": ["lib/sync/legacy.ts"],
        "branch": null
      }
    ]
  }
}
```

#### E — First plan with branch decomposition (Rule 1 or 2)

Same envelope as B/D; `plan.branches` fans out at build when execution resolves to per-unit. Step `branch` fields must reference known branch names.

```json
{
  "reply": "Split auth and billing into parallel workstreams with a shared contract step first.",
  "plan": {
    "markdown": "# Multi-branch plan\n\n…\n",
    "steps": [
      {
        "title": "Define shared event contract",
        "detail": "Protobuf/JSON schema in `api/events`.",
        "files": ["api/events/plan.proto"],
        "branch": null
      },
      {
        "title": "Implement auth service changes",
        "detail": "…",
        "files": ["services/auth/"],
        "branch": "auth"
      },
      {
        "title": "Implement billing hooks",
        "detail": "…",
        "files": ["services/billing/"],
        "branch": "billing"
      }
    ],
    "branches": [
      {
        "name": "auth",
        "title": "Auth stream",
        "scope": "OAuth + session refresh",
        "files": ["services/auth/"],
        "steps": ["s2"],
        "dependsOn": []
      },
      {
        "name": "billing",
        "title": "Billing stream",
        "scope": "Usage events",
        "files": ["services/billing/"],
        "steps": ["s3"],
        "dependsOn": ["auth"]
      }
    ]
  }
}
```

#### F — Branch thread, reply only (Rule 3)

User on the **auth** tab asks a scoped question. Agent responds without publishing.

**Engine:** assistant message on `thread = "auth"`; no new artifact.

```json
{
  "reply": "For the auth branch I kept refresh-token rotation in scope but left admin impersonation out—say if you want impersonation in this MR."
}
```

#### G — Branch thread, patch publish (Rule 3 → vN+1) — **preferred**

User asks for a small change on the **auth** tab. Agent returns **only the delta**; engine merges into existing meta (master `# Implementation plan` markdown unchanged).

**Engine:** `BranchRefinement.applyPatch`; `scopedRefine` + `refinedFrom.source: branch`.

```json
{
  "reply": "Extended step s2 with secure cookie flags—no other branches touched.",
  "subPlanPatch": {
    "upsertSteps": [
      {
        "id": "s2",
        "title": "Implement auth service changes",
        "detail": "Includes refresh rotation + Secure, HttpOnly, SameSite cookies.",
        "files": ["services/auth/session.ts", "services/auth/refresh.ts"],
        "branch": "auth"
      }
    ]
  }
}
```

Patch with **markdown-only** change (steps unchanged):

```json
{
  "reply": "Documented the rotation job schedule in the auth sub-plan.",
  "subPlanPatch": {
    "markdown": "## Auth sub-plan\n\n1. Rotation job (nightly)\n2. Cookie flags\n"
  }
}
```

Remove a step:

```json
{
  "reply": "Dropped the optional impersonation spike from auth.",
  "subPlanPatch": {
    "removeStepIds": ["s4"]
  }
}
```

#### G2 — Branch thread, full sub-plan (Rule 3 → vN+1)

Use when the branch had **no** `markdown` yet, or the user asked for a full rewrite. Still **no** master `plan` — only this branch’s document + steps.

```json
{
  "reply": "First detailed auth sub-plan—billing branch unchanged.",
  "subPlan": {
    "markdown": "## Auth sub-plan\n\n1. Rotation job\n2. Cookie flags\n3. Session fixation tests\n",
    "steps": [
      {
        "id": "s2",
        "title": "Implement auth service changes",
        "detail": "Rotation + cookie hardening.",
        "files": ["services/auth/session.ts"],
        "branch": "auth"
      },
      {
        "title": "Add session fixation tests",
        "detail": "Regression tests in `services/auth/tests/`.",
        "files": ["services/auth/tests/fixation.test.ts"],
        "branch": "auth"
      }
    ]
  }
}
```

**Anti-pattern (do not use on branch turns):** a full `plan` with every branch re-listed — wastes tokens and bypasses merge guards.

#### H — Planner execution hint (`execution_default: follow`)

When the node knob is `follow`, the planner may set execution resolution on the **plan** object (unknown values normalize to `whole` at publish time).

```json
{
  "reply": "Recommend fan-out per branch because auth and billing can land independently after the shared contract.",
  "plan": {
    "markdown": "# …\n",
    "steps": [{ "title": "…", "detail": "", "files": [], "branch": "auth" }],
    "branches": [{ "name": "auth", "title": "Auth", "scope": "", "files": [], "steps": ["s1"], "dependsOn": [] }],
    "execution": "steps",
    "execution_rationale": "Independent MRs per branch after shared contract merges."
  }
}
```

#### I — Explicit no publish (`plan` / `subPlan` / `subPlanPatch`: null)

Same as omitting publish keys (reply-only turn).

```json
{
  "reply": "Got it—I will include impersonation in the auth branch when you confirm.",
  "subPlanPatch": null
}
```

#### J — Agent error envelope (no plan publish)

When the agent cannot proceed, it uses the standard harness error shape (handled like today—**reply** conveys `reason`; no version).

```json
{
  "error": "agent_reported",
  "reason": "I cannot access the repo path `services/auth/` from this workspace—confirm the module path or adjust the task scope."
}
```

*(Exact envelope keys match `AgentOutputError.reported` in the engine; not a valid `PlanTurnOutput`, so the turn does not apply a plan.)*

#### K — Invalid `plan` when present (bounded retry)

Example: duplicate step ids or a step referencing an unknown branch. Outer envelope parses; inner `plan` fails `PlanResponse` refinements.

```json
{
  "reply": "Updated branches.",
  "plan": {
    "markdown": "# …\n",
    "steps": [
      { "id": "s1", "title": "A", "detail": "", "files": [], "branch": "missing-branch" }
    ],
    "branches": []
  }
}
```

**Engine:** one retry on the same session with violation feedback; if still invalid, conversational refusal in chat—no partial artifact, node not forced to `failed`.

#### Quick reference

| Scenario | Rule | Publish payload | Artifact |
|----------|------|-----------------|----------|
| Clarify before v1 | 1 | none | none |
| First publish | 1 | `plan` | v1 |
| Q&A on main | 2 | none | none |
| Main refine | 2 | `plan` | vN+1 |
| Q&A on branch tab | 3 | none | none |
| Branch delta | 3 | `subPlanPatch` | vN+1 (merged) |
| Branch full rewrite | 3 | `subPlan` | vN+1 (merged) |
| Cannot proceed | any | error envelope | none |

### Parse pipeline (single function)

Replace `parseFollowUp` + dual parse paths in `PlanOutputContract`:

1. `extractJson` → `PlanTurnOutput.safeParse`.
2. On failure → existing bounded retry (one feedback turn on same session).
3. On success:
   - Always return `reply` to caller for message log.
   - If no publish payload → stop (no artifact write; agent session still recorded).
   - If **`plan`** (whole/pre-publish only) → validate `PlanResponse`, publish full version.
   - If **`subPlan`** or **`subPlanPatch`** (branch only) → validate, merge, new artifact version with **unchanged master markdown** (today’s scoped publish path).
   - First **`plan`** publish moves node **`pending` → `awaiting_approval`**.

No turn kind may require `plan` in the output. Schema violations (malformed JSON, invalid `plan` payload when present) still use the existing **bounded retry**, then conversational refusal—not a forced publish.

### Provenance (`refinedFrom.source`)

| Turn kind | Suggested `source` |
|-----------|-------------------|
| First published version (from rule 1 pre-publish turns) | `start` if the initiating user message diverged from default template body, else default start |
| Whole (rule 2, plan present) | `chat` |
| Branch (rule 3, `subPlan` / `subPlanPatch`) | `branch` + `scopedRefine: { branch, from }` on output/meta as today |

Keep **`BranchRefinement.merge`** for `subPlan`; add **`applyPatch`** for `subPlanPatch`. Drop `applyChatPlan` as a separate concept — branch and whole both flow through `applyTurnResult`.

---

## Agent session model

### Today

- Single `nodes.agent_id` for the plan node.
- Branch scoped refine used `fresh` default **true** and optional follow-up on **node** agent, not branch-specific ids.
- `PlanNode.chat()` used `lastAgentId(node.id)` for whole-plan only.

### Target

Extend plan node **output** (JSON blob on `nodes.output`):

```ts
type PlanOutput = {
  latestArtifact: string;
  version: number;
  branches?: PlanBranch[];
  steps?: PlanStep[];
  scopedRefine?: { branch: string; from: number };
  /** branch name → harness agent id for resume */
  branchAgents?: Record<string, string>;
};
```

**Session rules:**

| Turn | `followUpOn` | After success, persist |
|------|----------------|-------------------------|
| Pre-publish (rule 1) | `null` on first harness run, then same as whole | Update `nodes.agent_id` after every successful turn (reply-only or plan-bearing) |
| Whole (rule 2) | `node.agent_id ?? lastAgentId(node.id)` | Update `nodes.agent_id` |
| Branch | `output.branchAgents[branch] ?? null` | Update `branchAgents[branch]` and optionally `nodes.agent_id` (recommend: **only** branch map for branch turns; keep node agent as “whole plan” session) |

**Recommendation:** Whole and branch sessions are **independent**. Whole turns never follow a branch agent; branch turns never follow the whole agent unless `branchAgents[branch]` was never set and you explicitly want shared session (default: **no**).

Implementation: small `PlanAgentSessions` helper:

- `resolveFollowUp(ctx, branchRef: string | null): string | null`
- `recordAgent(ctx, branchRef: string | null, agentId: string): void`

---

## Engine architecture

### New public surface

```ts
// flow-engine.ts
sendChat(...) // unchanged route entry for plan node
  → nodeRoles.chatRefinerOf(def)?.turn(ctx, content, { model, thread })
```

**Removed (no shims):**

- `refine_plan` action, `refineBranchPlan`, `PlanFollowUp`, `parseFollowUp`, legacy `run()` apply/recover paths
- `run_node` on the plan node — **`runNodeManual` rejects** plan with “use POST /chat”
- `PlanInput.branchRef`, `feedback`, `fresh` (turn snapshot uses `planThread`, `planTurnKind`, `turnUserMessage`)

`PlanNode.run()` throws; `PlanNode.chat()` delegates to `turn()` for the ChatRefiner interface only.

### Turn dispatcher (inside `PlanNode`)

```text
turn(content, thread?):
  branch = normalizeThread(thread)
  if branch:
    assertPlanExists()
    assertBranchExists(branch)
    return branchTurn(content, branch)    // rule 3
  if !latestPlanArtifact:
    return prePublishTurn(content)        // rule 1 — same apply as whole
  return wholeTurn(content)               // rule 2
```

Each sub-turn:

1. Build prompt via `PlanPromptBuilder` (see below).
2. `executeRun` / `startAgent` with resolved `followUpOn`.
3. `PlanOutputContract.applyTurnResult(...)` — single method.
4. Log user message + assistant `reply` on correct `thread` (messages are logged by `sendChat` before/after `turn`).

### Prompt builder

| Turn | Template key | Notes |
|------|--------------|--------|
| Pre-publish (rule 1) | `plan` (+ conversation contract) | First user message may be template body or a follow-up; prompt tells agent it may **`reply` only** until ready, then include **`plan`**. Same `PlanTurnOutput` in locked contract block as all other turns. |
| Whole (rule 2) | `plan_refine` | Vars: `feedback` = user message, context blocks = live plan state. |
| Branch | `plan_subplan_refine` (or rename) | Scoped context blocks; contract advertises **`subPlanPatch`** (preferred) and **`subPlan`**; **forbid `plan`**. Instruct model to emit **only changed** steps/markdown. |

| Branch | `plan_subplan_refine` | Scoped context; **`subPlanPatch`** (preferred) or **`subPlan`**; **forbid `plan`**. |

Branch session: `PlanAgentSessions.resolveFollowUp(branchName)`.

### PlanOutputContract

Single apply path: **`applyTurnResult`** / **`applyTurnResultWithRetry`** — dispatches `plan` | `subPlan` | `subPlanPatch` | reply-only. **`BranchRefinement.merge`** / **`applyPatch`** for branch publishes.

Recovery: **`recoverTurnOutcome`** only (requires `planTurnKind` on recorded node input). No bare `PlanResponse` replay.

### Recovery

`recover()` today skips scoped `branchRef` runs. After unification:

- Record turn kind + `thread` on run input snapshot.
- Recovery replays `applyTurnResult` from finished agent text; branch turns recover only when `thread`/`branchRef` recorded.

---

## HTTP / actions API

### Keep

| Route | Purpose |
|-------|---------|
| `POST /api/flows/:id/chat` | **All** plan sends (bootstrap + whole + branch). Body: `{ nodeKey, content, model?, thread? }`. |
| `GET /api/flows/:id/prompt?node=plan` | Composer prefill (bootstrap). |
| `GET /api/flows/:id/prompt?node=plan&branch=:name` | Optional branch-tab placeholder / future hint text (not a separate send). |
| `approve_plan`, checklist actions | Unchanged. |

### Remove

| Action | Replacement |
|--------|-------------|
| `refine_plan` | Removed — use `POST /chat` with `thread` = branch name |
| `run_node` on plan node | Rejected by engine — use `POST /chat` |

---

## UI architecture

### `usePlanComposer`

- Remove `isPlanPending` → `run_node` branch.
- Remove `onSendChatMutationFn` override entirely.
- Always rely on `useChatComposer` → `useSendChatMessage`.
- Map branch tab id → `thread` query/body (already partially wired in `ChatPanel`).

### Composer UX

| Phase | Prefill | Send label (optional) |
|-------|---------|------------------------|
| No artifact | Template body on first open (`prompts[nodeKey]`); clears after send like managed draft | “Send” (avoid “Generate plan” if clarifying turns are normal) |
| Has artifact | Empty draft (per-thread stash unchanged) | “Send” |

**Panel:** Until v1 exists, `PlanView` stays in empty/hint state while the chat rail carries the pre-publish conversation—same as reply-only turns after v1.

First send no longer mutates through action route — same loading/busy semantics (`flow.busy`, `current_node`).

### `composer-config.ts`

Update comment: send target is always chat for plan; remove `refine_plan` from documented union.

### Panel

- Remove branch “Refine” flows that call `refine_plan` (grep `REFINE_PLAN`, modals in `PlanView` / `SubPlanCard`).
- Branch tabs: conversational only; empty state copy unchanged.

### Docs

- Update `docs/architecture/plan-node.md` phases to three rules + single API table.
- Archive or mark superseded sections in `plan-conversation-refine.md` / `branch-scoped-refine.md`.

---

## Data model & migrations

- **No SQL schema change required** if `branchAgents` lives in `nodes.output` JSON.
- Backfill: existing flows have no `branchAgents`; first branch turn starts fresh (acceptable).
- Existing artifacts and `refinedFrom` remain valid.

---

## Implementation phases

### Phase 1 — Engine core (behind flag optional)

1. Add `PlanTurnOutput` to `schema.ts`; wire JSON schema into prompt locked blocks.
2. Implement `PlanAgentSessions` + extend `PlanOutput` type.
3. Implement `PlanNode.turn()` dispatcher + `applyTurnResult`.
4. Point `sendChat` → `turn()` for plan node only.
5. Tests: pre-publish reply-only; `plan` v1; whole reply/plan; branch reply; **`subPlanPatch`** merge; **`subPlan`** full merge; reject `plan` on branch turn.

### Phase 2 — Remove legacy paths

1. Remove `PlanNode.chat`, `refineBranchPlan`, `refine_plan` action.
2. Remove `PlanFollowUp`, `parseFollowUp`, and dual follow-up retries; add `SubPlanPatch` + `applyPatch`.
3. Simplify `PlanPromptBuilder` (delete scoped merge-only paths if unused).

### Phase 3 — UI

1. Simplify `usePlanComposer`.
2. Remove plan `run_node` from mutations usage.
3. Fix branch tab sends (already POST /chat) — verify engine respects `thread`.
4. Update architecture doc + in-app empty states.

### Phase 4 — Cleanup

1. Delete dead tests and prompt keys references.
2. `npm run build`, lint, manual QA script below.

---

## Test plan

### Unit (`lib/engine/nodes/kinds/plan/`)

- Parse: reply-only and plan-bearing for every turn kind; invalid JSON; invalid `plan` when present (bounded retry); agent error envelope.
- Sessions: branch A agent id persists; branch B independent; whole agent unchanged after branch turn.
- Apply: status guard refuses apply in wrong node status; provenance fields set correctly.

### Integration

- Fresh flow: prefill → clarifying reply-only turn(s) → user answers → turn with `plan` → v1 → approve path still works.
- Fresh flow (single shot): prefill → send → `plan` in first response → v1 (still valid).
- Main thread: question → reply only (no version increment).
- Main thread: change request → v2 + diff banner.
- Branch tab: first send creates branch agent; second send follows up.
- Unknown branch thread → 400.

### UI

- Single pending state for send (no action mutation).
- Thread draft stash unchanged when switching tabs.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Model sends full `plan` on branch tab | Directive + apply guard: retry once, then refusal; prompts say **patch or subPlan only**. |
| Patch upsert wrong branch on step | Server forces `branch` field to ref'd branch on merge; ids must belong to branch or be new |
| Scripts calling `run_node` on plan | Use `POST /chat` (see `verify-prompt-parity.ts` plan path). |
| Reply-only turns lost if model always sends `plan` | Prompt rules on **all** turn templates: omit `plan` when clarifying; tests on golden prompts. |
| Long pre-publish chat before v1 | Node stays `pending`; panel empty state + chat transcript is the UX; approve disabled until v1. |

---

## Open decisions (confirm before Phase 1)

1. **Pre-publish first message:** When composer was prefilled, log the user’s edited draft as the chat message (not the assembled harness prompt).
2. **Whole vs branch agent isolation:** Recommended independent; confirm product expectation.
3. **Invalid branch:** 400 (no fallback whole-plan turn).

---

## File touch list (expected)

| Area | Files |
|------|--------|
| Schema | `lib/engine/nodes/kinds/plan/schema.ts` |
| Node | `lib/engine/nodes/kinds/plan/plan-node.ts` |
| Contract | `lib/engine/nodes/kinds/plan/plan-contract.ts`, **`branch-refinement.ts`** (`applyPatch`) |
| Prompts | `lib/engine/nodes/kinds/plan/plan-prompt.ts`, `prompt-defaults.ts` |
| Engine | `lib/engine/flow-engine.ts` |
| API | `app/api/flows/[id]/action/route.ts` |
| UI | `usePlanComposer.ts`, `PlanNodeChat.tsx`, branch card refine actions |
| Docs | `docs/architecture/plan-node.md`, this doc → **current** when implemented |

---

## Acceptance criteria (Definition of Done)

- [x] Plan composer uses **only** `POST /chat` for generate + refine (whole and branch).
- [x] No **`PlanFollowUp`** / `parseFollowUp`; no **`refine_plan`** action; **`run_node`** rejected for plan node.
- [x] Single **`PlanTurnOutput`** envelope; branch publishes via **`subPlan`** / **`subPlanPatch`** only (no whole `plan` on branch turns).
- [x] **`SubPlanPatch`** merge covered by tests alongside existing **`SubPlanResponse`** merge tests.
- [x] Branch threads resume per-branch agent when `branchAgents[branch]` exists.
- [x] `npm run build` and plan node unit tests pass.
- [x] `docs/architecture/plan-node.md` updated to match shipped behavior.
