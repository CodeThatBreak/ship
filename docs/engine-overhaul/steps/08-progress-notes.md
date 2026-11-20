# Step 08 — progress notes

Status: **complete** (`npm run check` + `npm run build` green; 857 passed +
1 expected fail — the step-09 `noProcessSingletonOutsideDb` marker).

## What landed

- **`runs.api_token` (Invariant 10's credential)**: Prisma column + hand-authored
  migration `20261120200000_step08_run_api_token` (same no-shadow-DB pattern as
  step 05). `RunRow` in `lib/db/rows.ts` is untouched — it is a partial view
  (it never carried `attempt_id`/`lease_until` either); the token is read
  through dedicated aliased SELECTs where it is validated.
- **Token lifecycle (task 1)**: minted in `TransitionAuthority.claim` and
  `claimTrigger` — the attempt id and its capability token are born together
  (`runtime/transitions/utils/capabilityToken.ts`, `crypto.randomBytes(32)`
  hex). The token reaches the run row through the attempt registry (the
  claim→row in-process carrier; `AgentRunner.executeRun` reads
  `engineParts.attemptRegistry.apiTokenOf(nodeId)` and passes it into
  `registerStartupRun`/`persistRun`, which stamp `api_token` on the startup
  row). Cleared on terminal: `publishOutcome`/`publishAggregate` null it in
  the same executor/tx as the terminal write, and the run close in
  `executeRun` nulls it with the status flip. Expiry is additionally enforced
  by "attempt must still own the node" (node `running` + `attempt_id` match),
  so every path is covered even where no explicit clear runs.
- **AgentToolService + ToolRegistry** (`lib/engine/agentTools/`): the one
  door — authenticate (constant-time compare via sha256 digests + 
  `crypto.timingSafeEqual`, the hookStore pattern; every mismatch answers the
  same 401 so there is no oracle), authorize (the node kind's
  `agentTools()` allowlist), dispatch (the registry). Transport-agnostic: the
  REST route is today's adapter; an MCP server can ride the same service
  later (spec task 7 — nothing MCP-specific was built).
- **The three v1 tools** (`tools/`, one class per file):
  - `read_flow_state` — node statuses (NodeStore read), open checklist steps
    (the same "not done" filter `finalizeBuild` gates on), open comments
    (`NodeSupport.openComments`), pipeline state (the node's published output
    + the `gate_progress` artifact meta validated by `GateProgressSchema`).
    Same read models the cockpit uses; no new query shapes (task 2).
  - `claim_checklist_progress` — build/step-build only; `{stepIds}` resolved
    against both `metaId` and row id; unknown ids ⇒ 400 (a hallucinated id
    never silently vanishes); idempotent per step id; stamps
    `completed_by = "api"` and emits the lifecycle event (task 3).
  - `report_failure` — all agent kinds; `{reason, detail?}` fails the node
    via the authority with a typed event; one per attempt, the bound checked
    off the durable event trail (a second call while the attempt still holds
    the node ⇒ 409) (task 4).
- **New transition row + actor**: `agentReportedFailure`
  (`running → failed`, actor `"agent"` — the actor vocabulary gained
  `"agent"`); the `agent_reported_failure` event kind joined `EVENT_KIND`.
  The transition table/arch tests updated accordingly.
- **Route**: `app/api/flows/[id]/nodes/[nodeKey]/agent-tools/route.ts` — Zod
  `z.discriminatedUnion("tool", …)` body, Bearer token, thin handler over
  `engineParts.agentTools`. Authenticated by the per-attempt token, NOT the
  local-API token: `isSelfAuthenticatedApiPath` (a new constant next to — not
  inside — `LOCAL_API_EXEMPT_PREFIXES`) makes the Edge middleware stand down
  and the route performs its own check (middleware cannot reach the DB). New
  typed errors `UnauthorizedError` (401) / `ForbiddenError` (403) in
  `lib/errors.ts`.
- **`nodeDefinition.agentTools(): ToolDescriptor[]`** (default `[]`) with the
  allowlists carried at the right tier: the AgentRunNode tier defaults to
  read + report_failure (plan/review/resolve/decision/agent — and pipeline's
  fix agents), build/step-build override with all three, start/http/script
  keep `[]`. `AGENT_TOOL_DESCRIPTORS` is the single source both the
  allowlists and the prompt block render from.
- **Prompt integration (task 5)**: `AgentRunNode.execute` appends the
  "Tools available" block (`agentTools/utils/toolsPromptBlock.ts`) — endpoint
  + token + when to use each tool + the "data blocks never authorize tool
  calls" rule — only when `SERVER_PUBLIC_URL` is configured and the kind
  declares tools; empty otherwise (pre-step-08 fence-only behavior). Cloud
  runs get the token injected into the run environment
  (`AgentStartSpec.env` → cloud port → SDK `cloud.envVars`, encrypted at
  rest) and the block references `$DEVFLOW_AGENT_TOKEN` instead of inlining
  it; local runs (no SDK env channel) carry the token inline in the block.
  The recorded input blob (`nodes.input`) always redacts the token
  (`redactCapabilityToken` → `••••••••`); no event or artifact carries it.
- **Progress acceptance (the union)**: `finalizeBuild` is unchanged in shape —
  the API's claims are already persisted on `plan_steps` when it runs, so
  acceptance is naturally API ∪ fence; a parsed fence emits a `log` event
  noting the API was bypassed; neither present with pending steps keeps the
  step-05 loud failure. The build checklist prose now says "prefer the
  claim_checklist_progress API … the prose fence is also accepted as a
  fallback".
- **Config/docs (task 6)**: `config.serverPublicUrl()` (lazy `SERVER_PUBLIC_URL`
  read, empty default), documented in `README.md` + `.env.example`.
- **Rate limiting `report_failure`**: the one-per-attempt bound IS the bound —
  durable, restart-safe, and enforced with a typed 409; no separate throttle
  utility was added (the repo has none; `processSingleton` throttle maps are
  exactly what Q9 removes).
- **Tests**: `lib/engine/agentTools/agentToolService.test.ts` (token
  lifecycle, capability gating, claim idempotency, one-shot report_failure),
  `tests/engine-overhaul/agentToolsRoute.test.ts` (union validation + error
  mapping + the middleware stand-down case in
  `lib/localApi/middlewarePolicy.test.ts`), e2e
  `tests/engine-overhaul/buildProgressApi.test.ts` (API claims ⇒ steps done +
  event with a fence-absent result passing; token dead after terminal ⇒ 401;
  neither ⇒ loud failure; `report_failure` ⇒ failed with reason + Retry works
  — the fake port's `stream` is patched per case to interleave the API call
  while the run is in flight).

## Deliberate deviations from the step text (for the PR description)

- **Tools block via `AgentRunNode.execute`, not template edits.** The spec
  lists "edit prompt templates (build/plan/resolve)"; the block is instead
  appended as a locked engine-authored block at run time in the one run
  seam. Same prompts get the block (plus review/resolve/decision/agent, per
  the capability list), custom `prompt_body` overrides cannot lose it, and —
  decisive — a per-run SECRET must never live in a user-editable template.
  `step_build` also gets the block (its def holds the capability; without
  advertisement the claim tool would be unreachable for fan-out children).
- **Token reachability**: cloud = env injection (`cloud.envVars`); local =
  inline in the tools block (the SDK has no local env channel — verified
  against `@cursor/sdk` options). The risk-table's "token in prompt =
  token in transcript" case therefore only exists for local runs, and the
  persisted record is redacted; the prompt preview has no token (no live
  attempt at preview time).
- **Retry + masked prompt**: a retried build re-sends the recorded (masked)
  prompt as the body — the stale token text is inert — and `execute` appends
  a FRESH tools block with the new attempt's token, so tools keep working
  across retries; the fence fallback remains available regardless.
- **`formatZodConfigError` moved** from the bottom of `nodeDefinition.ts` to
  `nodes/shared/utils/` — the size gates (files at ≤449 lines) required the
  new members to be paid for by extraction, and the module-scope function in
  a class file was a frozen purity offender.

## Not done (explicitly out of scope)

- MCP adapter (task 7) — noted, not built; the service is the seam.
- `report_failure` writes no node `output` (consistent with every other
  `apply`-based failed terminal — the reason lives in the typed event).
