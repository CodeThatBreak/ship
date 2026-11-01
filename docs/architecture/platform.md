---
node_key: platform
kind: subsystem
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Platform utilities

## Summary

The platform layer is the cross-cutting foundation every other `lib/` subsystem builds on: environment configuration, HMR-safe singletons, the typed error hierarchy with HTTP mapping, request-boundary helpers (Zod parsing, capped body reads), the SSRF guard for template-authored outbound calls, local API authorization, the JSONata evaluator, and the shared Zod schema catalog. Nothing here knows about flows or nodes — dependencies point inward only.

## Architecture

### Config (`lib/config.ts`)

The **only** source of env values (AGENTS.md §1 — secrets and env come only from here). Values are read lazily via methods so tests and long-running processes see the current environment. The environment carries infrastructure config only (db path, workspace, `GITLAB_WEBHOOK_SECRET`, `DEVFLOW_SECRETS_KEY`); integration credentials live in the DB via Settings → Integrations. The secrets master key: `DEVFLOW_SECRETS_KEY` (32-byte base64url) in production; a deterministic scrypt dev key derived from the DB path otherwise (see `database.md` for the cipher).

### Singletons (`lib/singleton.ts`)

`processSingleton(key, create)` pins instances on `globalThis` via `Symbol.for`. Under `next dev`, route handlers bundle into separate module graphs, so module-scope `new Foo()` is **not** one-per-process — for stateful services (run-handle maps, throttle maps, interval flags) that divergence caused reconcile to fail healthy runs. This is the documented singleton factory; reuse it instead of inventing new `globalThis` patterns.

### Errors (`lib/errors.ts`)

`DomainError` carries an HTTP `status` and a closed `ERROR_CODE` (`invalid_input`, `not_found`, `conflict`, `upstream_error`). Subclasses: `ValidationError` (400), `NotFoundError` (404, `what`/`id`), `ConflictError` (409), `UpstreamError` (502, optional upstream status). Route handlers funnel through `toErrorResponse` — domain errors map to their status + code, anything else logs and returns a bare 500.

### Request boundary (`lib/http/parse.ts`, `lib/net/readCappedBody.ts`)

- `parseJson(req, schema)` — Zod-validated JSON body parsing; the first issue formats as `path: message` and throws `ValidationError`.
- `readCappedUtf8Body(req, maxBytes)` — byte-accurate capped body read: rejects on oversized `Content-Length` before streaming, aborts mid-read past the cap (`RequestBodyTooLargeError`). Used by webhook/raw-body routes.

### SSRF guard (`lib/net/`)

`ssrfGuard.ts` protects **template-authored** outbound calls (the http node — see `declarative-nodes.md`). Per request hop: scheme http/https only; hostname against the `http_allowlist` setting (empty = deny-by-default); DNS-resolved once with **every** resolved address required to be public (loopback/private/link-local/CGNAT/ULA/multicast/reserved rejected, IPv4-mapped IPv6 re-classified); the pinned address drives the connection (custom net lookup, TLS SNI + Host stay on the original name) so re-resolution between check and connect is impossible; every redirect hop re-validates. `ssrfHelpers.ts` owns the IP classification (via `ipaddr.js` — deliberately no `ip-address`/`private-ip` deps), `ssrfError.ts` the typed `SsrfError`. Vendor API clients (GitLab/Jira/Cursor) do not pass through it — they are operator-configured, not template-authored.

### Local API auth (`lib/localApi/`)

Routes are authorized by a process-local token: `token.ts` creates-or-reads a 32-byte hex token (env `LOCAL_API_TOKEN` override, mirrored onto `process.env` for middleware); `authorizeRequest.ts` compares the `x-devflow-token` header (or Bearer) against it with a constant-time compare. Unauthenticated requests fail closed.

### JSONata (`lib/jsonata.ts`, `lib/jsonata/eval.ts`)

The expression language of the declarative surface: edge `condition`s, decision `expression`s, `input_map` fields, http `response_map`s. `JsonataEvaluator` compiles once and caches by text; jsonata v2's `evaluate()` is async, so every caller awaits. The evaluator is a **pure module** (no store/engine imports) so the template editor's client-side compile checks share it without dragging server code into the browser bundle. Exports: `evalJsonata`, `jsonataTruthy`, `jsonataFail`, `lintJsonata`, `templateRefs` (static `{{ref}}` extraction for lint).

### Schemas (`lib/schemas/`)

The shared Zod boundary catalog: `flowActionBody.ts` (the `POST /api/flows/:id/action` discriminated union), `integrationInstance.ts`, `settingValues.ts` (typed setting getters), `settingsPatch.ts`, `repo.ts`. `nodeTemplate.ts` is covered in `templates.md`. Types are inferred (`z.infer`), never duplicated.

### Small utilities

- `maskToken.ts` — `••••<last4>` masking for settings UIs (never the real value).
- `format.ts`, `utils.ts` — pure display/misc helpers.
- `eslintPolicyProbe.ts` — vitest-only probe proving the `no-explicit-any` lint policy fires (ignored in normal lint).
- `modelSpec.ts` — model spec parsing; covered in `agent-harness.md`.

## API surface

These modules have no routes of their own; they are the boundary machinery routes are built from (`parseJson`, `toErrorResponse`, `localApiRequestAuthorized`, the schema catalog).

## Data model

Stateless, except: the local API token (process env), the JSONata compile cache (in-memory), and settings rows accessed through `settingValues.ts` getters (see `database.md`).

## Out of scope

- At-rest encryption of secrets — see `database.md`.
- Git credential hygiene — see `git.md`.
- Webhook verification schemes — see `flow-engine.md` (`HookStore`) and `gitlab-integration.md`.

## Related code index

| Concern | Location |
|---------|----------|
| Env/config | `lib/config.ts` |
| Singleton factory | `lib/singleton.ts` |
| Typed errors | `lib/errors.ts` |
| Body parsing | `lib/http/parse.ts`, `lib/net/readCappedBody.ts` |
| SSRF guard | `lib/net/ssrfGuard.ts`, `ssrfHelpers.ts`, `ssrfError.ts` |
| Local API token | `lib/localApi/token.ts`, `authorizeRequest.ts` |
| Token masking | `lib/maskToken.ts` |
| JSONata | `lib/jsonata.ts`, `lib/jsonata/eval.ts` |
| Zod catalog | `lib/schemas/` |
