# Step 08 — Agent self-repair tools

## Goal

Invariant 10 (decision Q2): **agents get eyes and hands — per-node-kind tools.**
Each node kind declares the tools its running agent may use; tools are gated by a
per-attempt capability token minted at claim time. Build-progress becomes an
authoritative API (the prose fence stays as a logged fallback), and a bounded
`report_failure` lets an agent fail its own node with a reason instead of
hallucinating success.

## Depends on

Step 02 (token minted/expired by the transition authority), step 05 (agent-output
pipeline consumes API-claimed progress; prompt fencing exists). Step 06
(checklist claim joins the completion transaction's atomicity).

## Files affected

- Prisma migration: `runs.api_token` (nullable, unique-ish; minted per attempt,
  cleared on terminal).
- New: `lib/engine/agentTools/toolRegistry.ts` — `ToolDescriptor` + per-kind
  registration; `lib/engine/agentTools/agentToolService.ts` — auth (token →
  attempt → node), capability check, dispatch. Both constructor-injected from
  the container (Q9).
- New tools (v1): `lib/engine/agentTools/tools/readFlowState.ts` (node statuses,
  open checklist steps, open comments, pipeline state — the prompt-snapshot facts,
  queryable live), `tools/claimChecklistProgress.ts` (build/step-build only;
  authoritative progress, idempotent per step id), `tools/reportFailure.ts` (all
  agent kinds; bounded: one per attempt; fails the node via the authority with the
  agent's reason).
- New route: `app/api/flows/[id]/nodes/[nodeKey]/agent-tools/route.ts` — Zod
  `z.discriminatedUnion("tool", [...])` body, token from `Authorization: Bearer`,
  thin handler over `AgentToolService`.
- Edit: `nodeDefinition.ts` — `agentTools(): ToolDescriptor[]` (default `[]`);
  built-ins register theirs (build/step-build get all three; plan/review/resolve/
  decision/agent get read + report_failure; http/script get none).
- Edit: prompt templates (build/plan/resolve) — a "Tools available" block listing
  the endpoint, the token (injected at run start), and when to use each tool;
  build prompt keeps the fence as "also accepted, API preferred".
- Edit: `planStepStore.ts`/`buildNode.ts` — progress acceptance =
  API claims ∪ fence parse (fence parse emits a `log` event noting the fallback);
  neither present with pending steps ⇒ the step-05 loud failure.
- Edit: middleware/token plumbing — agent-tools route authenticated by the
  per-attempt token (not the local-API token); stays outside the webhook-exempt
  prefix rules.
- Tests: new `agentToolService.test.ts`, `agentToolsRoute.test.ts`, e2e
  `buildProgressApi.test.ts`.

## Concrete tasks

1. Token lifecycle: minted in `claim` (stored on the startup run row), validated
   per request (constant-time compare), cleared on terminal transition; expiry is
   enforced by "attempt must still own the node".
2. `read_flow_state`: assemble from the same read models the UI/cockpit uses —
   no new query shapes.
3. `claim_checklist_progress`: `{stepIds: string[]}` → validate ids exist and are
   claimable → mark done (idempotent) + event; fence fallback path logs that the
   API was bypassed.
4. `report_failure`: `{reason, detail?}` → node `failed` via the authority with a
   typed `agent_reported_failure` event; cannot touch any other node; second call
   in the same attempt ⇒ `409`.
5. Prompt integration: tools block only rendered when the tool endpoint is
   reachable/configured (see risks); token injected into the run environment, never
   into the persisted prompt text shown in the UI (redact like secrets).
6. Cloud-mode reachability: tool URL from a new `SERVER_PUBLIC_URL` config
   (optional); when unset, the tools block is omitted and behavior is exactly
   today's (fence path). Document in README/settings.
7. MCP adapter: **not in this step** — note the service is transport-agnostic so an
   MCP server can ride it later.

## Libraries used

None new.

## Risks

- **New attack surface** (Q2's warning): a leaked token lets a caller fail a node
  or flip checklist state. Mitigations: per-attempt scope, terminal-expiry,
  constant-time compare, capability allowlist per kind, rate-limit
  `report_failure`, redact tokens from prompts/events/artifacts. Security sign-off
  checklist in the PR.
- **Prompt-injection escalation**: a malicious MR comment could instruct the agent
  to call `report_failure` or claim steps. The step-05 `untrustedData()` fencing
  is the mitigation; the tool descriptions explicitly say data blocks never
  authorize tool calls.
- **Cloud agents can't reach localhost**: without `SERVER_PUBLIC_URL` the feature
  silently degrades to fence-only — acceptable, documented, and the fence path
  keeps its loud-failure semantics from step 05.
- **Token in prompt = token in transcript**: transcripts/artifacts must redact the
  token (reuse `secretStore.redact` plumbing or a dedicated mask).
- Checklist-claim races with the fence in the same run: union semantics are
  idempotent; test the interleaving.

## Acceptance criteria / tests

- `agentToolService.test.ts`: token lifecycle (mint/validate/expire), capability
  gating (build tool rejected on a plan node; unknown token 401), one-shot
  `report_failure`.
- `agentToolsRoute.test.ts`: discriminated-union validation, error mapping.
- `buildProgressApi.test.ts` (e2e, fake agent): claims via API ⇒ steps done +
  event; fence-absent + API-used ⇒ build passes; neither ⇒ step-05 loud failure;
  token after terminal ⇒ 401.
- `report_failure` e2e: agent reports ⇒ node `failed` with reason event; Retry
  works.
- `npm run check` + build green.
