---
node_key: <node_key>
kind: builtin | declarative | child
status: current | draft
owner: <team>
last_reviewed: YYYY-MM-DD
---

# <Human-readable node name>

## Summary

<!-- 2–4 sentences -->

## Capabilities contract

| Field | Value | UI / engine effect |
|-------|--------|-------------------|
| `refinable` | | |
| `chatMode` | | |
| `promptNode` | | |
| `panelTitle` | | |

<!-- chainRole, builtinApproval, resourceArtifacts as bullets if set -->

## User-visible phases

### Phase 1 — …

- **Entry:**
- **Surface:**
- **Action:**
- **Outcome:**

<!-- Repeat phases; add mermaid if helpful -->

## UI architecture

### Workspace routing

### Panel (`<PanelComponent>`)

### Chat rail

### Async states

### Key files

- `components/…`

## Backend architecture

### Node class

### Collaborators

### Run lifecycle (`run`)

### Chat lifecycle (`chat` / `converse`)

### Approval and advance

### Key files

- `lib/engine/…`

## API surface

### HTTP

| Route | Caller | Purpose |
|-------|--------|---------|

### Flow actions

| Action | When | Engine |
|--------|------|--------|

### Actions not used

## Data model

### Input

### Output / artifacts

### Side effects

## Agent contracts

### Prompt keys

### Response shapes

### Retries and guards

## Fan-out and downstream

<!-- optional -->

## Provenance and review UI

<!-- optional -->

## Future

<!-- optional: shipped separately -->

## Out of scope

## Related code index

| Concern | Location |
|---------|----------|
