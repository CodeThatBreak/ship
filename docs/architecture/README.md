# Architecture documentation

This folder holds **current-state** architecture for builtin and declarative nodes: how the UI and engine work today, not migration plans or legacy behavior. Completed plans and one-off migration specs were removed from the tree; see [`docs/archive/`](../archive/README.md) for context.

When you add or change a node’s behavior, update its architecture doc in the same PR when the change is user-visible or crosses the API boundary.

---

## Documentation schema (standard for every node)

Each node doc is a single markdown file: `docs/architecture/<node-key>.md` (use the engine `NODE_KEYS` value, e.g. `plan`, `build`, `review`).

Copy [`_template.md`](./_template.md) when authoring a new doc. Every section below is **required** unless marked optional. Keep prose factual; link to code paths instead of duplicating implementation line-by-line.

### 1. Document header (metadata)

A short YAML block at the top:

```yaml
---
node_key: plan          # engine NODE_KEYS / node.type for builtins
kind: builtin           # builtin | declarative | child
status: current         # current | draft (not yet shipped)
owner: engine+flows     # team or area (free text)
last_reviewed: 2026-10-30
---
```

### 2. Summary

Two to four sentences: what the node does in the product, and what makes its UX or contract special compared to generic agent nodes.

### 3. Capabilities contract

Table mapping **`NodeCapabilities` / `NodeUiCapabilities`** fields this node sets to what the client does with them. If the node does not set a field, say “—”.

| Field | Value | UI / engine effect |
|-------|--------|-------------------|

Also list **chain role** flags when applicable (`builtinApproval`, `chainRole`, `resourceArtifacts`, etc.).

### 4. User-visible phases

Numbered **phases** the developer experiences (not internal state names). For each phase:

- **Entry condition** (what must be true on the flow/node)
- **Primary surface** (panel vs chat vs both)
- **Primary action** (what send / button does)
- **Outcome** (status, artifacts, what changes)

Use a mermaid `flowchart` or `sequenceDiagram` when the phase graph is non-obvious.

### 5. UI architecture

| Subsection | Content |
|------------|---------|
| **Workspace routing** | How `resolveNodePanel` (or equivalent) picks panel + chat components |
| **Panel** | Container component, local state (reducers/hooks), child sections |
| **Chat rail** | Generic `ChatPanel` vs custom rail; composer send targets |
| **Loading / error / empty** | Where each state is handled (AGENTS §2.8) |
| **Key files** | Bullet list of `components/…` paths (barrel imports via feature `index.ts`) |

No deep-import paths across features.

### 6. Backend architecture

| Subsection | Content |
|------------|---------|
| **Node class** | `lib/engine/nodes/kinds/…` entry type and tier (`AgentRunNode`, etc.) |
| **Collaborators** | Service classes the node delegates to (one line each) |
| **Run lifecycle** | `run()` — inputs, prompts, validation, persistence |
| **Chat lifecycle** | `chat()` / `converse()` if applicable — must differ from default `AgentRunNode` behavior when overridden |
| **Approval / advance** | How the node leaves `awaiting_approval` and what the engine runs next |
| **Key files** | Bullet list under `lib/engine/…` |

### 7. API surface

Tables for **HTTP routes** and **flow actions** this node relies on. Columns: method/path or action name, caller (UI hook/script), payload summary, engine entrypoint.

Explicitly state actions this node **does not** use (helps avoid resurrecting legacy paths).

### 8. Data model

- **Input schema** (`PlanInput`-style): fields the run/chat/action paths consume
- **Output schema** / node output blob
- **Artifacts** (kind, meta fields, versioning rules)
- **Side tables** (e.g. `plan_steps`) if the node owns or syncs them

### 9. Agent contracts

- Prompt template keys (`promptKeys`)
- Response JSON schemas (run vs chat turn vs scoped refine if different)
- Retry / refusal semantics (bounded retry, state guards)

### 10. Fan-out and downstream (optional)

Only if the node publishes split units, child flows, or execution resolution. Describe knob + meta precedence; name the consumer node (`build`, etc.).

### 11. Provenance and review UI (optional)

How the panel shows diffs, version labels, and meta (`refinedFrom`, `scopedRefine`, etc.).

### 12. Out of scope

What this doc **intentionally excludes** (legacy flows, unrelated subsystems, future work tracked elsewhere).

### 13. Related code index

Compact table: **Concern → primary file(s)** for navigation.

---

## Conventions

- **Present tense**, **current behavior** only in node docs; put “planned” items in a short **Future** subsection, not mixed into phases.
- **Name API actions and `FLOW_STATUS` values** as code literals (backticks).
- Prefer linking to [`AGENTS.md`](../../AGENTS.md) for React/engine coding rules rather than repeating them.
- Diagrams: mermaid only; keep them readable in GitHub/Cursor preview.

## Index

| Doc | Topic |
|-----|--------|
| [client-bundle-boundaries.md](./client-bundle-boundaries.md) | Client vs server imports, ESLint allowlist, loaders seam |
| [plan-node.md](./plan-node.md) | Plan — implementation plan, conversational refine, branch split source |
| [plan-unified-turns.md](./plan-unified-turns.md) | Plan chat / unified turns (current behavior) |
