# Plan: resolve node — strict output contract, prompt cleanup, real retry semantics

## Motivation

The resolve node is the only agentic node with **no output contract**. The agent
returns free text, and the engine invents the machine outcome afterwards: it
detects whether code moved (`detectCodeChange`) and then blanket-resolves **every
open thread** on the MR (`shouldResolveCommentsOnHost(open.length, codeChanged)`).
Consequences:

- Threads the agent never addressed — or explicitly disagreed with — get closed
  whenever any code changed.
- The agent cannot answer a reviewer's question in the thread; the port has no
  reply-to-discussion method, and nothing posts the agent's words back to the MR.
- The prompt carries runtime-computed `header` / `subheader` / `instructions`
  variables (a rules block) that duplicate what the template should say
  statically, drift between `run()` and `previewPrompt()`, and include a
  "Start by checking out branch X" line that is wrong in local mode (the flow
  worktree already has the branch checked out — `ensureFlowWorktree(ctx, mrBranch)`).
- Retry is an afterthought: no contract retry, one-shot host calls, swallowed
  verification errors, and `recover()` always fails the node even when the agent
  finished and only the side effects were interrupted.
- There is no push state. `detectCodeChange` is true when the MR head moved
  **or the local branch fingerprint changed** — and in local mode the resolve
  agent only ever *commits locally* (nothing in the node pushes; `pushBranch`
  is only called by `MergeRequestService` during MR creation). The node then
  closes review threads on the host for fixes the reviewer cannot see on the
  MR, and the loop edge re-runs pipeline/review against an MR head that does
  not contain the fix.

This plan makes the node contract-driven end to end: the agent declares a
per-comment disposition, the engine applies it deterministically and
idempotently, and every failure mode has a defined retry story.

---

## 1. Gap audit (what this plan fixes)

| # | Gap | Evidence | Fix |
|---|-----|----------|-----|
| G1 | Runtime-computed `header`/`subheader`/`instructions` prompt variables | `resolveNode.ts` `run()` (~lines 103–106), `promptDefaults.ts` resolve template rules block `{{header}}\n{{subheader}}\n{{instructions}}` | §2 — static contract block, variables deleted |
| G2 | No output contract; blanket resolution of all open threads | `resolveComments.ts` (`shouldResolveCommentsOnHost`), finalize loop resolving every `c in open` | §3 — per-comment disposition contract |
| G3 | Agent cannot reply to a thread | port has `createComment` (top-level), `createInlineComment` (new discussion), `resolveComment` only — no discussion-note method | §5 — `replyToComment` port addition |
| G4 | No contract retry; agent's free text is never validated | `resolveNode.ts` `finalize` uses `result.result` verbatim | §6 — one bounded feedback retry (`AgentOutputError` standard) |
| G5 | Host effects are one-shot; transient 429/5xx/timeout permanently fails the effect | finalize `try/catch` per comment, `hostFailures++`, move on | §6 — bounded per-effect retry honoring `retryAfterMs` |
| G6 | Verification errors swallowed as "no change" (CR-075 class) | `captureState` / `detectCodeChange` `.catch(() => null)` | §6/§6A — four-state `pushed \| local_only \| none \| unknown`, loud error event |
| G7 | `recover()` always false — a restart mid-finalize loses a finished agent run | `recover()` at file end | §6 — recover re-applies the recorded result through the contract + ledger (agentNode precedent) |
| G8 | Non-resolvable comments (no `discussion_id`, individual notes) counted as host failures and stay open forever | `attempts.push({ commentId: c.id, ok: false })` for missing `discussion_id` | §4 — classified, never host-called, locally closed when handled |
| G9 | Multi-note threads: one row per note, same `discussion_id` → duplicate host resolves; only some rows marked | finalize iterates rows, not threads (`mapDiscussion` flat-maps notes → rows) | §4 — dedupe per discussion, mark all rows of the thread |
| G10 | Bot-reply self-ingestion loop: a posted reply returns via poller/webhook as a NEW open comment → debounce fires → agent replies to itself forever | `commentStore.ingest` inserts every non-system note as `open`; only the `resolved_by='agent'` guard stops re-opens | §4 — insert the posted reply locally as `resolved`/`resolved_by='agent'` at post time (existing guard then covers it) |
| G11 | No loop-termination story for answered-but-open threads: next cycle re-presents them, agent re-answers | debounce re-fires while `open > 0` (`waitScheduler.processWaitTimers`) | §2/§3 — prompt marks already-replied comments; agent skips them; `pushed=false` ends the loop |
| G12 | `openComments` has no `ORDER BY` → nondeterministic prompt | `nodeSupport.ts:328` | §7 — `ORDER BY created_at ASC, id ASC` |
| G13 | Prompt comment lines have no ids — a strict contract cannot reference them; bodies uncapped | `list = open.map(...)` in `run()` | §2 — id-tagged, capped comment block |
| G14 | `setupNote` string-concatenated onto the prompt after assembly (I7 parity rule) | `prompt += \n${binding.setupNote}…` | §2 — `{{setup_note}}` data block in the template |
| G15 | Preview/run divergence: preview uses `ctx.flow.mr_branch ?? buildBranch`, run uses `mrTargetResolver`; preview still passes the deleted `instructions` var | `previewPrompt()` | §7 — preview uses `mrTargetResolver` + same extras shape as run |
| G16 | Input mutation + `as ResolveInput` cast | `input = { ...input, prompt: body, promptIsBody: true } as ResolveInput` | §7 — rebuild via schema parse, no cast (also flagged for review in PR description) |
| G17 | `ctx.flow.repo_url ?? ""` then `forRepo("")` — nullish fallback hides missing data (AGENTS §2.9) | `captureState`, `finalize` | §7 — early guard with a clear error |
| G18 | `gitHostRegistry` singleton used directly (ReviewNode injects `GitHostResolver`) → untestable without spying | `captureState`/`detectCodeChange`/`finalize` | §7 — constructor injection, mirrors `ReviewNode` |
| G19 | Raw `"error"` / `"log"` strings in `support.emit` instead of `EVENT_KIND` constants (§2.7) | finalize error emit | §7 — constants |
| G20 | Output too poor to drive anything: `{ resolved, codeChanged }` | `schema.ts` | §3 — per-action counts + `hostFailures`; `codeChanged` kept for the loop edge |
| G21 | **No push state**: local fingerprint change counts as `codeChanged` even when the fix was never pushed; threads close on the host and the loop edge fires against an MR head without the fix | `detectCodeChange` (local `stat` fingerprint ⇒ true), `LocalBranchState.pushed` never read, nothing calls `pushBranch` after the resolve run | §6A — `pushState` (`none`/`local_only`/`pushed`) drives resolution authority; engine pushes unpushed local commits (local mode) before resolving; loop edge requires `pushed` |

Out of scope (unchanged): `quiet_minutes` debounce, `mcp_sources`, split knobs,
`chat()`/`converse()` shape, webhook/poller ingestion mechanics beyond what
G10/G11 touch. The loop-edge condition **is** in scope: it migrates to
`nodes.resolve.output.pushed = true` (§6A).

---

## 2. Prompt template redesign (G1, G13, G14)

`lib/engine/prompts/promptDefaults.ts` — the `resolve` template becomes:

```ts
resolve: {
  label: "Comment resolution",
  description: "Sent to the agent to address open MR review comments by committing fixes or replying.",
  userTemplate: `{{dev_instructions}}`,
  internalBlocks: [
    { kind: "contract", text: RESOLVE_CONTRACT_TEXT },   // static text + {{branch}} + {{contract}}
    { kind: "data", text: `Open merge-request comments:\n{{comments}}` },
    { kind: "data", text: `{{setup_note}}` },
  ],
  variables: ["branch", "comments", "dev_instructions", "contract", "setup_note"],
  mode: "agent",
},
```

- **Deleted variables:** `header`, `subheader`, `instructions`, `mode`. The
  deleted "Start by checking out branch X" local-mode line is intentionally not
  replaced: in local mode the agent's `cwd` is the flow worktree which already
  has `mrBranch` checked out; in cloud mode `startingRef: mrBranch` covers it.
- **`{{contract}}`** carries `AgentOutputError.directive(RESOLVE_RESPONSE_JSON_SCHEMA)`
  — rendered from the Zod schema (`z.toJSONSchema`, the plan-node precedent), so
  the advertised schema and the validator can never drift. `previewPrompt()` and
  `run()` pass the identical value → preview/run parity by construction (I7).
- The contract block's static prose states the semantics the JSON Schema can't:
  reply required for `answered`/`wontfix`, exactly one disposition per listed
  comment id, resolve semantics per action (§3), "commit fixes to branch
  {{branch}}".
- **`{{comments}}`** — one line per open comment row, deterministic order
  (G12), id-tagged so the contract can reference it:

  ```
  - [gl_123] src/a.ts:2 — Rename the badly named variable. (author: @reviewer)
  - [gl_124] (MR note, not resolvable) — Question: why two clients? (author: @dev)
  - [gl_125] src/b.ts:9 — Drop the cast. (author: @reviewer; you replied on 2026-11-04 — awaiting reviewer)
  ```

  Per-comment body capped (2 000 chars) and the whole block capped (40 000 chars)
  with an explicit truncation note (review's 60 000-char diff-cap precedent).
  Null `body` renders as empty, never the string `"null"`.
- **`{{setup_note}}`** — the worktree dependency-setup note becomes a template
  data block instead of post-assembly concatenation. Empty in preview and when
  there is no note; empty blocks are filtered by `assemblePrompt`, so parity holds.
- The "already replied" marker (G11): `resolveContract.presentComments()` joins
  each open row with any same-`discussion_id` row carrying `resolved_by='agent'`
  → renders the "you replied on … — awaiting reviewer" suffix. Next cycle the
  agent sees its reply already landed and `skipped` the thread; with nothing
  else to do `pushed=false` and the loop terminates.

## 3. The output contract (G2, G8, G20)

New module `lib/engine/nodes/kinds/resolve/resolveContract.ts` (Zod + parser;
pure functions, the `reviewComments.ts` precedent).

### Agent response schema

```ts
export const RESOLVE_COMMENT_ACTION = {
  FIXED: "fixed",
  ANSWERED: "answered",
  WONTFIX: "wontfix",
  SKIPPED: "skipped",
} as const;
export type ResolveCommentAction = (typeof RESOLVE_COMMENT_ACTION)[keyof typeof RESOLVE_COMMENT_ACTION];

export const ResolveCommentDecision = z.object({
  /** comment row id from the prompt list, e.g. "gl_123" */
  id: z.string().min(1),
  action: z.enum(["fixed", "answered", "wontfix", "skipped"]),
  /** posted back to the thread. Required for answered/wontfix; optional for
   *  fixed (a "what changed" note); must be absent for skipped. */
  reply: z.string().min(1).optional(),
  /** close the thread on the host. skipped ⇒ false. */
  resolve: z.boolean(),
  /** one-line internal note for the artifact/run log (never posted) */
  note: z.string().optional(),
});
export type ResolveCommentDecision = z.infer<typeof ResolveCommentDecision>;

export const ResolveAgentResponse = z.object({
  /** human summary — becomes the artifact content and the chat reply */
  summary: z.string().min(1),
  /** self-report; the engine verifies this (§6) and never trusts it for the loop edge */
  codeChanged: z.boolean(),
  decisions: z.array(ResolveCommentDecision),
});
export type ResolveAgentResponse = z.infer<typeof ResolveAgentResponse>;

/** Advertised in the prompt directive; refinements enforced server-side. */
export const RESOLVE_RESPONSE_JSON_SCHEMA: unknown = z.toJSONSchema(ResolveAgentResponse);
```

### Semantic validation (beyond Zod) — `parseResolveResponse(text, openIds)`

1. `extractJson` → null ⇒ `AgentOutputError` `no_json`.
2. `AgentOutputError.reported(parsed)` ⇒ `agent_reported` (escape hatch, never retried).
3. Zod parse ⇒ issues ⇒ `schema_mismatch`.
4. Coverage: the decision ids must equal the presented open-comment id set —
   unknown ids and duplicates rejected, missing ids listed by name in the issues
   (retryable `schema_mismatch`).
5. Refinements: `answered`/`wontfix` ⇒ `reply` present; `skipped` ⇒ `resolve: false`
   and no `reply`.

Zero open comments + `instructions` run (the chat "make this change" mode):
`decisions: []` is valid; coverage is trivially satisfied.

### Action semantics (what the engine does — decision matrix)

| Decision | Reply effect | Resolve effect |
|----------|--------------|----------------|
| `fixed` + `resolve` + `pushState = pushed` | post reply if present, **then** resolve | host resolve (deduped per discussion) + local mark all thread rows |
| `fixed` + `resolve` + `pushState = pushed` + thread not resolvable (G8) | post reply if present | local mark only — no host call, never counted as failure |
| `fixed` + `resolve` + `pushState = local_only` (engine push failed on infra) | post reply if present | **not resolved**; stays open; output `pushed=false`; event names the push failure — the next debounce cycle retries the push (§6A) |
| `fixed` + `resolve` + `pushState = none` + reply present | post reply (it explains, e.g. "already landed in abc123") | resolve honored — the agent took explicit, explained responsibility; warning event emitted |
| `fixed` + `resolve` + `pushState = none` + no reply | — | **not resolved**; stays open; warning event; counted as `skipped` |
| `answered` / `wontfix` | post reply (required) | `resolve` honored as declared (no code claim is made); default template guidance is `false` — the reviewer closes |
| `skipped` | none | none; `note` surfaced in artifact meta |

**Design decision D1:** the per-comment contract replaces the blanket
`codeChanged` gate as the resolution authority (CR-209's spirit kept: no
unexplained, unverified closures). `pushState` (§6A) is the fixed-safeguard:
a `fixed` decision only closes a thread when the fix is verified **on the
remote MR head** — or the agent explicitly takes responsibility in a posted
reply. This removes today's stuck case: a retry after a host outage re-runs
the agent over already-pushed fixes; `before` == `after` ⇒ no new commits ⇒
the old blanket gate could never close the threads again.

**Design decision D1a (push authority):** a thread is resolved on the host
**only when the fix is on the remote MR** (`pushState = pushed`). Closing a
thread for a commit that exists only in a local worktree is the one outcome
worse than leaving it open — the reviewer sees "resolved" with no fix on the
MR. `local_only` therefore never resolves; it either becomes `pushed` via the
engine's push step, or it degrades the run (§6A).

**Design decision D2:** posted replies carry the `**AI Resolve**\n\n` prefix
(review's `**AI Review**` precedent) for MR-side transparency.

### Node output schema (`schema.ts`)

```ts
export const ResolveOutput = z.object({
  /** threads actually closed (host-resolved + local-only closes) */
  resolved: z.number(),
  replied: z.number(),
  wontfix: z.number(),
  skipped: z.number(),
  /** host effects that failed after bounded retry */
  hostFailures: z.number().default(0),
  /** engine-verified code movement anywhere (local or remote) — informational */
  codeChanged: z.boolean().default(false),
  /** engine-verified: the fix is on the remote MR head — the loop-edge condition value */
  pushed: z.boolean().default(false),
  branchName: z.string().optional(),
});
```

- **`pushed`** is the state you asked for: true only when the MR head on the
  host moved (or the engine pushed and re-verified). It is the loop-edge
  condition value — the seeded template edge condition must migrate from
  `nodes.resolve.output.codeChanged = true` to `nodes.resolve.output.pushed = true`
  (`lib/db/templateSeeder.ts` ×2, plus the seeded YAML fixtures). Pipeline and
  review both operate on the **remote** MR, so looping on a local-only change
  was always wrong — today it re-reviews a diff without the fix.
- `codeChanged` stays in the output (informational: the agent changed code
  somewhere, local or remote) but nothing should gate on it. Keeping the field
  avoids breaking any edge conditions in user templates that reference it.
- Nothing else reads `output.resolved` (verified: only docs and the node
  itself), so the output reshape is safe.

### Artifact

kind `resolve`; content = `summary` plus a rendered per-comment decision list;
meta = `{ decisions, counts, codeChanged, pushState, hostFailures, ledger }`
where `ledger` is the idempotency record (§4).

## 4. Effect application (G5, G8, G9, G10)

New module `lib/engine/nodes/kinds/resolve/resolveEffects.ts` — class
`ResolveEffects` (constructor-injected `NodeSupport` + `GitHostResolver`;
AGENTS §3.1), **replacing `resolveComments.ts`**, which is deleted with its
test (current-flow-only rule — no shims).

- **Planning (pure):** decisions × comment rows × `pushState` × resolvability
  → ordered effect list. Replies always precede the resolve of the same thread.
  Resolvability is parsed from the comment row's `raw` JSON (the
  `commentService.listForFlow` pattern) — **no `schema.sql` change** (avoids the
  AGENTS §1 approval gate; a `resolvable` column can be a follow-up).
- **Thread dedupe (G9):** one host resolve per `discussion_id`; on success all
  local rows of that discussion are marked (`resolveComment` per row, or a new
  `resolveComments(ids: string[])` batch method on `NodeSupport`).
- **Bounded host retry (G5):** module-local `withHostRetry(fn)` — 2 extra
  attempts, backoff `min(1s · 2ⁿ, 8s)`, honors `GitHostApiError.retryAfterMs`,
  retries only 429/5xx/`GitHostTimeoutError`; 401/403/404 are permanent
  (`gitHostErrorFromResponse` already classifies). A permanent/exhausted failure:
  thread stays open, `hostFailures++`, `EVENT_KIND.ERROR` event; remaining
  effects continue.
- **Idempotency ledger:** artifact meta persists after **every** effect
  (review's `persistProgress` precedent): `{ replies: [{ hash, noteId }],
  resolvedDiscussions: [...] }`. Reply hash = sha256(`mrIid`, `discussionId`,
  `body`) — re-application skips ledgered effects.
- **Self-ingestion guard (G10):** `replyToComment` returns the created note; the
  node immediately inserts it as a comment row with `status='resolved'`,
  `resolved_by='agent'` (new `NodeSupport.recordAgentReply` — nodes never import
  `db`, the T1 seam). The existing `commentStore.ingest` guard
  (`resolved + resolved_by='agent' + incoming open → skip`) then covers the
  poller **and** webhook paths, and the thread UI shows the agent's reply. The
  webhook's unconditional `bounceCommentWaits` is harmless: the timer only fires
  a run when `open > 0`.
- **Local-only closes (G8):** disposition handled (`fixed`) on a non-resolvable
  thread → local rows marked `resolved_by='agent'`; nothing on the host; not
  counted as failure.

## 5. Port addition: reply to a discussion (G3)

- `lib/engine/ports/gitHost.ts` — add to `GitHostClient` and `GitHostService`:

  ```ts
  /** Post a note into an existing discussion thread; returns the created note. */
  replyToComment(repoUrl: string, crNumber: number, threadId: string, body: string):
    Promise<{ id: string; author: string; createdAt: string }>;
  ```

- `lib/integrations/gitlab/client.ts` — `createMRDiscussionNote(projectPath,
  mrIid, discussionId, body)` → `POST /projects/:p/merge_requests/:iid/discussions/:did/notes`.
- `lib/integrations/gitlab/gitHost.ts` — adapter wiring on both classes; the
  returned note maps to the `gl_${note.id}` id scheme used by `mapDiscussion`
  (so the G10 local insert dedupes against ingestion). Only the GitLab host
  implements the port today — no other adapters to touch.

## 6. Retry and recovery semantics (G4–G7)

Four layers, each with exactly one behavior:

1. **Contract retry (in-run).** `finalize` calls
   `applyContractWithRetry(result)` — the `agentNode.applyOutputWithRetry` /
   `planContract.applyTurnResultWithRetry` pattern: on `no_json` /
   `schema_mismatch` (incl. coverage failures) emit a lifecycle event and run
   **one** feedback turn on the same agent session (`followUpOn:
   lastAgentId`), prompt = the specific issues + the re-stated directive
   (`TemplateRenderer` + `AgentOutputError.directive`, built in
   `resolveContract.ts`). `agent_reported` propagates immediately with the
   agent's reason. A second miss throws `AgentOutputError` → node `failed` →
   manual Retry. `RETRYABLE_OUTPUT_ERRORS` is defined locally in the module
   (plan/agentNode both define their own — follow that).
2. **Host-effect retry (in-finalize).** §4's `withHostRetry`, per effect.
3. **Verification (push state) hardening.** `detectCodeChange` becomes
   `verifyPushState` and returns `pushed | local_only | none | unknown`
   instead of swallowing to `null` (§6A). `unknown` behaves as `none` for
   effects (threads stay open — never resolve on unverifiable state) and
   yields `output.pushed=false` (the loop stops safely), plus a loud
   `EVENT_KIND.ERROR` event.
4. **Restart recovery.** `recover()` re-applies the **recorded** agent result
   through the contract and completes the remaining effects from the artifact
   ledger, then `applyOutcome(ctx, outcome, { note })` — the `agentNode.recover`
   precedent ("recovery is persistence-only"). Returns `false` only when the
   recorded result is missing or unparseable → the reconciler fails the node
   for manual retry. Manual `retry` re-runs the agent from the recorded input
   (unchanged engine path); already-pushed fixes and the already-replied markers
   (§2) make that re-run converge instead of looping.

## 6A. Push state (G21) — was the fix pushed to the remote?

The run's real deliverable is code **on the MR**, not code in a worktree. The
verification therefore produces a three-state `pushState` (plus the `unknown`
error state of §6 layer 3), and resolution authority (D1a) and the loop edge
both key off it.

### States

| State | Meaning | How it's detected |
|-------|---------|-------------------|
| `pushed` | The MR head on the host holds the fix | MR head SHA moved (`before.mrSha` → after, host API — the one 5 s propagation recheck stays), **or** local mode: after the engine's own push, `origin/<branch>` tip == the new local tip |
| `local_only` | The agent committed locally but the remote branch does not have the commits | `unpushedAhead > 0` (`origin/<branch>` behind the local tip, or missing) AND MR head SHA unchanged — checked pre-run and post-run, so a previous cycle's stranded commits are detected too |
| `none` | No code movement anywhere | Neither signal |

`LocalBranchState` needs one extension for this: the current `pushed` flag only
says `origin/<branch>` *exists* — not that it is *current*. Add
`unpushedAhead: number` (`rev-list --count origin/<branch>..<branch>`, treating
a missing `origin/<branch>` as "everything is unpushed") in `lib/git/local.ts`
with tests; `pushed`-as-existence stays untouched for its current consumers.

### Engine push step (local mode only)

Runs at two points — **pre-run** (flush a previous cycle's stranded commits
before the agent starts) and **in `finalize`** (when `pushState = local_only`
after the agent's work) — regardless of which decisions the contract carries;
stranded commits on the MR branch help no one. Both points share one helper:

1. `localGit.pushBranch(localPath, mrBranch, repoUrl, gitRemoteContextFor)` —
   the exact call `MergeRequestService.create` uses (origin remote first,
   token-authed HTTPS fallback, one retry for flaky pre-push hooks).
2. On failure, classify with `isHookRejection` (`mergeRequest/errors.ts`):
   - **Hook rejection** (pre-push/pre-receive — the repo's gates rejected the
     code): one bounded agent feedback turn with the hook output, then re-push
     once (the `MergeRequestService.createWithFixes` precedent, bounded to a
     single fix). A second rejection fails the node with the truncated hook
     detail as the run's error — hook rejections do not degrade gracefully:
     the repo's gates have spoken and silent open threads would stall the
     review loop forever with no signal.
   - **Infra failure** (network/VPN/auth): **not** a node failure — the agent's
     work is real and a transient outage shouldn't punish it. Replies still
     post (they need no push authority), no thread resolves, output
     `pushed=false`, and the event names the push failure. The still-open
     comments keep the debounce alive, so the next quiet period re-runs
     resolve; the engine pushes the already-committed branch *before* the
     agent run (cheap pre-step — the worktree commits persist), making the
     retried cycle converge instead of redoing work.
3. On success, `pushState = pushed`; effects proceed with full resolution
   authority. Push success is itself the verification — the MR-head SHA re-read
   afterwards is informational only (still behind the 5 s recheck).
4. Push is part of `finalize`, so `recover()` (§6 layer 4) re-attempts it
   naturally — and `pushBranch` on an already-pushed branch is a no-op success
   ("Everything up-to-date"), keeping recovery idempotent.

Cloud mode has no local path: `pushed` derives solely from MR-head movement —
the cloud agent owns pushing (`startingRef` model). If the head didn't move,
the state is `none` and threads stay open (today's "no code changes" path).

### Consequences

- **Resolution authority (D1a):** `fixed + resolve` closes a thread only in
  state `pushed`. `local_only` after an infra push failure degrades (replies
  post, threads stay open, `pushed=false`); `local_only` after a hook
  rejection fails the node; `none` → the §3 matrix rows.
- **Pre-run push catch-up:** the `local_only` check runs at the **start** of
  `run()` too — a previous cycle's stranded commits are pushed before the
  agent starts, so a transient outage self-heals on the next debounce cycle
  without re-doing agent work (detection uses `unpushedAhead`, not the
  before/after fingerprint, so "no new commits this run" still flushes the
  backlog).
- **Loop edge:** output `pushed` (not `codeChanged`) — pipeline and review read
  the **remote** MR, so looping on local-only code reviews a diff without the
  fix. Migrate the seeded condition `nodes.resolve.output.codeChanged = true`
  → `nodes.resolve.output.pushed = true` in `lib/db/templateSeeder.ts` (×2) and
  the `docs/flow-templates/sdlc-loop.yaml` fixture (test-imported), and update
  the architecture docs that quote it (`database.md`, `templates.md`,
  `resolve-node.md`, `review-node.md`).
- **Uncommitted changes** are invisible by design: `localBranchState` compares
  committed refs (`base...branch`). The contract prose tells the agent to
  *commit* its fixes; work left uncommitted in the worktree reads as `none` and
  threads stay open — the agent didn't finish.
- **Event/reply copy** distinguishes the states: `resolved 3 thread(s) — fixes
  pushed` vs `fixes committed locally but push failed: <reason>`.

## 7. Node rewiring (`resolveNode.ts`) and shared cleanups

- `run()`: delete `header`/`subheader`/`instructions` computation; build the
  prompt as one `assemblePrompt(RESOLVE, { branch }, { dev_instructions,
  comments, contract, setup_note })` call for both the default and
  `promptIsBody` paths (G1, G14). Keep `prompt_body` folding but rebuild the
  input via `ResolveInput.parse({ ...input, prompt: body, promptIsBody: true })`
  — no mutation, no cast (G16; flag review's identical pattern in the PR
  description, don't fix it here).
- Constructor takes `GitHostResolver = gitHostRegistry` (ReviewNode precedent,
  G18); `captureState`/`verifyPushState`/`finalize` use it (`detectCodeChange`
  is renamed and re-shaped per §6 layer 3 / §6A).
- Early guard `if (!ctx.flow.repo_url) throw …` instead of `?? ""` (G17).
- `EVENT_KIND.ERROR` / `EVENT_KIND.LOG` for `support.emit` types (G19).
- `previewPrompt()`: resolve the branch via `mrTargetResolver` (same as run),
  pass the same extras shape with the `comments`/`setup_note` slots empty (G15).
- `chat()` / `chatInput()` unchanged; the chat reply becomes `contract.summary`
  (a better answer than today's raw text dump).
- `nodeSupport.openComments`: add `ORDER BY created_at ASC, id ASC` (G12 — only
  consumer is resolve plus tests).
- `nodeSupport`: add `recordAgentReply(...)` insert (G10) and optionally
  `resolveComments(ids: string[])` batch mark (G9).

## 8. Steps (implementation order)

1. `resolveContract.ts` — action constants, Zod schemas, JSON-schema export,
   `presentComments()` (prompt lines + markers), `parseResolveResponse()`
   (extractJson → envelope → zod → coverage), retry-prompt builder. Tests first.
2. Port + GitLab `replyToComment` (`gitHost.ts`, `client.ts`,
   `integrations/gitlab/gitHost.ts`).
3. `nodeSupport.ts` — `ORDER BY`, `recordAgentReply`, `resolveComments(ids)`.
4. `resolveEffects.ts` — planner + `withHostRetry` + ledgered application.
   Delete `resolveComments.ts` + `resolveComments.test.ts`.
5. `schema.ts` — new `ResolveOutput` (adds `pushed`; keeps `codeChanged`).
6. `promptDefaults.ts` — template rewrite (variables
   `branch, comments, dev_instructions, contract, setup_note`).
7. `lib/git/local.ts` — `LocalBranchState.unpushedAhead` + tests (§6A).
8. `resolveNode.ts` — rewiring per §7 (incl. `verifyPushState`, the engine push
   step, `applyContractWithRetry` in `finalize`, new `recover()`).
9. Loop-edge migration: `lib/db/templateSeeder.ts` (×2) and
   `docs/flow-templates/sdlc-loop.yaml` → `nodes.resolve.output.pushed = true`.
10. Tests (§9).
11. Docs (§10).

## 9. Tests

- `resolveContract.test.ts` (new): parse happy path; `no_json`; envelope →
  `agent_reported`; schema mismatch with issues; coverage (missing id names the
  id; unknown id; duplicate id); reply-required refinements; `skipped` ⇒ no
  reply/no resolve; `decisions: []` with zero open comments; `presentComments`
  ordering, id tags, not-resolvable marker, already-replied marker, caps.
- `resolveEffects.test.ts` (new, injected fake host + in-memory support):
  the full decision matrix (§3); reply-before-resolve ordering; thread dedupe
  (two rows, one discussion → one host call, both rows marked); non-resolvable
  → local-only close, not counted; 429→retry→success, 429→exhausted→hostFailures
  with thread left open; 404 → no retry; ledger skip on re-application;
  `recordAgentReply` insert shape.
- `resolveNode.test.ts` or extend `chatFirstTurn.test.ts`: stub runner returns
  contract JSON (the existing resolve chat tests must be updated — their stub
  `"rename done"` is no longer valid output); contract failure → exactly one
  feedback run with `followUpOn` → second failure fails the node;
  `verifyPushState` four-state (API error ⇒ `unknown` ⇒ no resolution, error
  event); `recover()` completes ledgered effects and returns true.
- Push state (§6A): `unpushedAhead` (missing `origin/<branch>` ⇒ all commits
  unpushed; tip equality ⇒ 0); `local_only` + push success ⇒ threads close and
  `pushed=true`; hook rejection ⇒ one agent fix turn ⇒ re-push ⇒ second
  rejection fails the node with hook detail; infra failure ⇒ node **done**
  with `pushed=false`, replies posted, no thread closed, and the next cycle's
  pre-run push flushes the backlog; cloud mode (no local path) ⇒ MR-head
  movement only.
- Loop edge: seeded template / YAML fixture test asserts the condition is
  `nodes.resolve.output.pushed = true` (the fixtures are test-imported, so the
  YAML side fails the suite if it drifts).
- Keep the two existing chat-behavior assertions intact (comment body and
  `Developer instructions:` still appear in the prompt).

## 10. Docs

- `docs/architecture/resolve-node.md` — rewrite: Run lifecycle steps 3–5,
  "Response shapes" (now the JSON contract), "Retries and guards" (the four
  layers), the push-state model (§6A), Data model (output/artifact meta),
  Collaborators (`resolveContract`, `resolveEffects`, `replyToComment`), and
  the variables list of the template.
- Architecture docs quoting the old loop condition: `docs/architecture/database.md`,
  `docs/architecture/templates.md`, `docs/architecture/review-node.md`
  (mermaid diagram) — update to `pushed`.
- PR description flags: review node's identical `as` cast/input-mutation (G16,
  untouched per AGENTS §2.10), and that this work extends review-task 22's
  CR-209 fix (already marked Fixed) to contract-driven resolution.

## 11. Verification (definition of done)

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.
- `grep -rn "header\|subheader" lib/engine/prompts/promptDefaults.ts lib/engine/nodes/kinds/resolve/` — no deleted variables left.
- `grep -rn "shouldResolveCommentsOnHost\|countHostResolved" lib/` — gone.
- Demo smoke (non-reset seed): seed a flow, post an MR question comment and a
  fix-me comment, run resolve — question gets a thread reply and stays open,
  fix-me gets code **pushed** (event says so) + closed thread, loop edge fires
  exactly once on `pushed`. In local mode, verify the agent's commits land on
  the remote MR branch even when the agent itself never runs `git push`.
- Prompt preview for `resolve` renders the contract block identically to a run
  (byte-parity), with empty `comments`/`setup_note` slots.

## 12. Deliberately out of scope

- No `schema.sql` change (`resolvable` stays parsed from `raw`; a column is a
  possible, approval-gated follow-up).
- No changes to the debounce/quiet-period machinery or the review node (its
  identical input-mutation is flagged, not fixed).
- No auto-fix loop beyond the single bounded hook-rejection feedback turn —
  multi-attempt push repair stays with `MergeRequestService.createWithFixes`.
- No push in cloud mode from the engine — the cloud agent owns pushing
  (`startingRef`); the engine only verifies MR-head movement there.
- No cross-run dedupe of *paraphrased* replies (the agent-side already-replied
  marker is the mechanism; identical bodies are hash-deduped per run).
- No GitHub/other host adapters — none implement the port today.
