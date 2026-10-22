# Branch-Scoped Sub-Plan Refinement

Date: 2026-10-22 · Status: **Phase A + B implemented** (Phase C pending)

> Implemented: `SubPlanResponse` + `validateSubPlan`, `PlanBranch.markdown`, `PlanInput.fresh` /
> `contextBlocks`, the `plan_subplan_refine` template, `PlanNode` scoped run + context block
> registry + per-mode scoped retry, `mergeBranchRefine` (id-preserving deterministic merge),
> `PlanStepStore.replaceBranch` (preserves done state by meta_id), scoped recovery skipped,
> `refine_plan` action wiring, `GET /api/flows/[id]/prompt?branch=` + context block list,
> PromptModal context picker + fresh-agent toggle, branch tabs / refine buttons / diff banner /
> staleness badges in `PlanView`. Phase C (chat scope chip, apply-on-confirm meta, per-branch
> approval gating) is not implemented yet.
>
> Try it: `npm run seed:branch-refine` → open the seeded DEMO-207 flow.
> Edge checks: `npx tsx scripts/check-branch-refine.ts` (merge, diff, validation, template composition).

Companion to `docs/refinement-plan.md` (Phase 3A). Proposal only — no code changes yet.

## Problem

Today every plan refinement — whole-plan or per-branch — asks the agent to re-emit the
**entire** `ComplexPlanResponse` (`plan_complex_refine`, "Return the FULL revised plan"). For
"change one branch's sub-plan" this is the wrong shape:

- **Drift** — untouched branches and the plan markdown silently change on every refine.
- **Reliability ∝ 1/output size** — the bigger the JSON, the more likely a schema failure, and
  the existing auto-retry re-burns the full cost of a whole-plan run.
- **No ownership of change** — a new version can't say what changed without diffing large
  markdown blobs by eye.

`branchRef` is already plumbed end-to-end (`PlanInput.branchRef` → `flow.refinePlan()` → action
route) but the UI never sends it, and `PlanNode.buildPrompt()` only uses it as a boolean trigger
in `buildContextBlock()` (dumping the last 3 full plan versions as context).

## Design: two-level plan model

**Level 1 — decomposition** (branches, scopes, file ownership, dependency graph): stable
architecture, changed only by a full-plan refine, explicitly re-approved.

**Level 2 — branch sub-plans**: each branch's executable detail, with its own refine loop,
markdown, and diff. Refining one branch **replaces only that branch** — merge is deterministic
code, not AI.

Rule of thumb: the smaller and more singular the asked-for output, the better the result —
and the code, not the prompt, enforces "don't touch what wasn't asked about".

## 1. Scoped response schema (`schema.ts`)

New narrow schema — a branch refine response is just this branch's sub-plan:

```ts
/** Response for a branch-scoped refine: this branch's sub-plan only. */
export const SubPlanResponse = z.object({
  /** This branch's implementation detail in Markdown (rendered in the branch tab). */
  markdown: z.string().min(1),
  /** Refined steps for THIS branch; "branch" is forced to the ref'd branch on merge. */
  steps: z.array(PlanStep).min(1), // each step's "branch" must be null or the ref'd branch
});
export type SubPlanResponse = z.infer<typeof SubPlanResponse>;
```

Validation (`validateSubPlan`, mirrors `validateSimplePlan`): `safeParse` + `normalizeStepIds`
only. No branch-name/dependsOn cross-checks — there are no branches in scope. A step's `branch`
may be `null` **or** the ref'd branch name — an agent echoing the branch name must not fail
validation (merge forces it either way). A failure costs one small retry, not a full plan
regeneration.

`PlanBranch` gains one optional field so the scoped markdown has a home:

```ts
subPlan: z.object({
  prompt: z.string().min(1),
  steps: z.array(PlanStep).optional(),
}).optional(),
/** This branch's own plan document — written by a branch-scoped refine, shown in the branch tab. */
markdown: z.string().optional(),
```

## 2. Prompt template (`prompts.ts` → `plan_subplan_refine`)

New key; `plan_complex_refine` stays for unscoped (whole-plan) refines. Registered in
`PlanNode.promptKeys`.

```
Refine ONLY the sub-plan for the branch `{{branch}}` of the implementation plan.

## Branch contract — do not change it
- scope: {{scope}}
- files: {{files}}
- depends on: {{dependsOn}}
{{dependsOnSummaries}}

## Current sub-plan prompt
"""
{{subPlanPrompt}}
"""

## Current steps
{{currentSteps}}

## Developer feedback
"""
{{feedback}}
"""

{{context}}

Return a JSON object ONLY — no prose before or after, no code fences. The JSON must match:
{
  "markdown": "<this branch's implementation detail in Markdown>",
  "steps": [{"id":"s1","title":"Short imperative title","detail":"What to change and why","files":["path/to/file.ts"]}]
}

Rules:
- your output replaces ONLY the `{{branch}}` sub-plan — other branches are planned elsewhere
  and your response must not affect them
- the branch scope and file list above are the contract: keep the sub-plan inside them; if the
  feedback seems to require going outside the scope, keep the change minimal and say so in the
  first step's "detail"
- "steps" is REQUIRED — non-empty, ordered; unique short ids (s1, s2, …) — reuse the existing ids
  of unchanged steps so they keep their identity (the diff is id-based)
- each step "files" lists exact paths; reuse the current steps where they are still correct —
  don't rewrite what doesn't need to change
- the "Current steps" list may include developer hand edits — treat them as intent and preserve
  them unless the feedback changes them
- do NOT add any fields not listed above
- your entire response must be parseable as a single JSON object
```

Variables resolved by `PlanNode` (all from the **latest plan artifact meta**, not from other
versions):

- `dependsOnSummaries` — for each `dependsOn` branch: `- \`name\` (title): scope` (one line).
  This is what the sub-plan may *assume exists*; nothing else about other branches is sent.
- `currentSteps` — the branch's current steps as a compact list (`- s3: title — detail (files)`),
  sourced from the **live checklist rows** (`planSteps`), not artifact meta. Hand edits are
  therefore part of the refine's input by construction — the model preserves them unless the
  feedback changes them, and the scoped `replaceBranch` sync (§5) is not lossy for user intent.
- `context` — assembled from the **context block registry** (§4), not from
  `buildContextBlock()`. Empty by default for scoped refines: today's dump of 3 full plan
  versions is noise for a scoped edit. The developer can add blocks in the PromptModal; the
  branch contract block is always present for scoped refines regardless of selection.

The verbatim-prompt path composes as:

```
{{developerPromptBody}} + internalSuffix("plan_subplan_refine", …, { branch, scope, … })
```

so the "Edit prompt" modal keeps working with `promptIsBody` — the modal shows only the
developer-editable body, the scoped rules are appended at run time.

## 3. `PlanNode.buildPrompt()` branching + fresh-agent flag

```
if (input.branchRef) {
  if (!complex plan / branch unknown) → fall through to whole-plan refine (log why)
  if (input.prompt)        → prompt body + internalSuffix("plan_subplan_refine", …)
  else                     → prompts.resolve("plan_subplan_refine", { …vars above })
  label  = `sub-plan refine (${input.branchRef}${input.fresh ? ", fresh" : ""})`
  followUp = input.fresh ? null : node.agent_id
}
```

### Fresh agent vs. follow-up agent

New `PlanInput` flag — `fresh: z.boolean().default(false)`. When true, the run does **not**
follow up on the existing agent (`followUpOn: null`); it starts a clean agent that sees only
what the prompt contains.

Defaults per refine type:

- **Scoped refine → fresh by default.** The scoped template is self-contained (branch contract
  + current steps + feedback is everything the model needs), so conversation memory isn't
  required. The only thing a follow-up saves is repo re-exploration — and that exploration is
  *bounded by the branch's file list* (the agent reads 6 files, not the repo). Small cost,
  removes the biggest hallucination source: long, accumulated context that biases the model
  into defending its earlier decisions.
- **Whole-plan refine → follow-up by default.** The conversation genuinely holds the
  decomposition rationale, and the output is large, so grounding advantages matter most.

Why the option matters beyond defaults:

- **Quality escape hatch** — a fresh run composes with `input.model`: "new agent + stronger
  model" is the explicit lever when a refine keeps coming back wrong, instead of silently
  retrying the same polluted context.
- **Replayability** — a fresh run's prompt is fully visible in `nodes.input.prompt` and
  replayable; a follow-up run's effective prompt includes invisible conversation state and can
  never be replayed. Better for audit and debugging ("why did the plan change?").

The complementary relationship with the context picker: for a **fresh** agent the picker
controls *everything* the model sees (there is no conversation to lean on), so curated context
isn't optional for fresh runs — it's what makes them grounded. For a **follow-up** agent the
picker only controls what's *added* on top of conversation memory. Build both together; a
fresh-agent refine without the picker would be a bare prompt and would hallucinate more, not
less.

### Scoped retry: parameterize `generatePlan`, don't branch inside it

The existing retry path re-emits the FULL-plan schema hint with "Re-emit the FULL plan" wording.
A scoped retry must stay scoped: introduce a per-mode parse config — parser/validator +
`schemaHint` + requirements list — and call `generatePlan` with it.

- Scoped `schemaHint`: `{"markdown":"<this branch's sub-plan>","steps":[{"id","title","detail","files"}]}`.
- Scoped requirement line mirrors the template: replace ONLY this branch — never re-emit the full
  plan or other branches' steps.
- Retry `followUp` stays `lastAgentId`: a fresh run that fails validation gets corrected
  in-conversation — still one small retry, not a regeneration.
- Recovery: `recover()` cannot distinguish a scoped response from a whole-plan one; an
  interrupted scoped run being replayed must not be silently merged. Phase A skips scoped
  recovery — treat a replayed scoped run as failed → retry.

## 4. Context block registry (picker data + assembly)

`PlanInput` gains `contextBlocks: z.array(z.string()).default([])` — ids of the blocks to
assemble into `{{context}}`. `buildContextBlock()` becomes a registry keyed by id:

| id | Block | Scoped default | Whole-plan default |
|---|---|---|---|
| `ticket` | Ticket context (PRD, Figma links, acceptance criteria) | on | on |
| `contract` | Branch scope, files, `dependsOn` one-line summaries | **pinned on** | — |
| `current` | The branch's current sub-plan prompt + **live checklist rows** — hand edits included, they are developer intent the refine must respect (§2) | on | — |
| `branches` | Other branches — title + scope summaries only | off | on |
| `versions` | Previous plan versions (today's 3×3000-char dump) | off | off |
| `edits` | The developer's live `PlanSteps` hand edits, passed as "the developer already adjusted the plan like this — respect these changes" | — (scoped refines cover hand edits via `current`, §2) | on |

Rules:

- **`contract` is locked for scoped refines.** Removing it would let the agent silently change
  the branch's scope. Shown with a lock icon and a tooltip in the UI; the engine ignores it in
  the selection array.
- **`contextBlocks` ids are whitelisted server-side** — unknown ids are dropped silently and
  logged at debug. The client selection is a hint, not a spec, matching the rule that context is
  always re-assembled server-side (§7.5).
- **`versions` default is off for whole-plan too — this preserves current behavior**: today's
  unscoped refines receive no plan-version context (`buildContextBlock()` returns `""` without
  `branchRef`), so the 3×3000-char dump is dead code reachable only via the never-sent
  `branchRef` path.
- **Defaults are the minimal-context recommendation** (§3). The picker's job is to show what
  the model sees and allow *expansion*, not to tempt users into pruning.
- **Char counts per block + total** rendered in the UI — makes "small context in, small output
  out" visible; ticking `versions` (+9k chars) self-corrects.
- Hand edits: today a refine overwrites hand-edited checklist rows. For **scoped** refines this
  is solved at the source — `currentSteps` is built from live rows (§2), so no separate block is
  needed; `edits` is whole-plan-only, where live rows are passed as intent the refine should
  preserve.
- Assembly order is fixed (`ticket → contract → current → branches → versions → edits`) so
  prompts stay comparable across runs.

## 5. Merge logic (`plan-node.ts` — pure function, deterministic)

```ts
/** Replace exactly one branch's sub-plan + its top-level steps. Everything else byte-identical. */
function mergeBranchRefine(meta: PlanMeta, branchName: string, sub: SubPlanResponse): PlanMeta {
  const idx = meta.branches.findIndex(b => b.name === branchName);
  if (idx === -1) throw new Error(`branch "${branchName}" not found`);

  // 1. Keep the agent's step ids unless they collide with steps we keep — unchanged steps
  //    retain identity, which is what makes the id-based diff (§6) meaningful.
  //    (Blanket re-id would give every incoming step a fresh id, so even a "reuse s2" step
  //    would surface as remove+add in the diff.)
  const taken = new Set(meta.steps.filter(s => s.branch !== branchName).map(s => s.id));
  const reId = (s: PlanStep, i: number) => {
    let id = s.id?.trim() || `s${i + 1}`;
    if (taken.has(id)) { let n = taken.size + 1; while (taken.has(`s${n}`)) n++; id = `s${n}`; }
    taken.add(id);
    return { ...s, id, branch: branchName };
  };
  const newSteps = sub.steps.map(reId);

  // 2. Splice into the top-level step list IN PLACE (keep global ordering):
  //    remove the old steps of this branch, insert new ones at the same position.
  const kept = meta.steps.filter(s => s.branch !== branchName);
  const firstOld = meta.steps.findIndex(s => s.branch === branchName);
  // slice(0, firstOld) cannot contain this branch's steps — the earlier `.filter` was a no-op.
  const keptBefore = firstOld === -1 ? kept.length : firstOld;
  kept.splice(keptBefore, 0, ...newSteps);
  const steps = kept;

  // 3. Update the branch record: titles, scoped markdown, subPlan (prompt preserved unless
  //    the agent returns a revised one — it doesn't in v1, so keep the existing prompt).
  const branches = meta.branches.map(b => b.name === branchName
    ? { ...b, steps: newSteps.map(s => s.title), markdown: sub.markdown,
        subPlan: b.subPlan ? { ...b.subPlan, steps: newSteps } : undefined }
    : b);

  return { steps, branches };
}
```

Persist as a **new artifact version** (same as today's `saveArtifact`), with meta:

```ts
saveArtifact(node.id, flow.id, "plan", /* unchanged plan markdown */ prevMarkdown, {
  ...prevMeta, steps, branches,
  scopedRefine: { branch: branchName, from: prevVersion }, // provenance for the diff banner
});
```

Then sync the live checklist **scoped**, not wholesale:

```ts
planSteps.replaceBranch(flowId, art.id, branchName, newSteps); // delete rows where branch=X, insert new
```

(new `planSteps` variant; `syncFromPlan` stays for full-plan runs.)

## 6. Lifecycle event + output

- Event: `branch 'billing' sub-plan refined · 4 steps (+1 / −0) — other branches untouched`.
- `PlanOutput` stays as-is; artifact meta carries `scopedRefine.branch` so PlanView can render a
  **"what changed"** banner computed in the client by comparing the two versions' steps for that
  branch: `{ added: [], removed: [], changed: [{ id, before, after }] }` (title/detail/files).
  No server diff endpoint needed.

**Diff matching is id-based with a title fallback** — merge preserves ids for unchanged steps
(§5), so:

| Pair | Classification |
|---|---|
| id in both versions, content equal | unchanged |
| id in both versions, content differs | `changed` |
| id only in the new version | `added` |
| id only in the old version | `removed` |

Leftover unmatched pairs that match by `title` (agents occasionally rename ids on unchanged
steps) are promoted to `changed`; anything still unmatched stays `added`/`removed`.

## 7. UI wiring (`PlanView.tsx`)

1. **Refine button on each branch card** — visible when `awaiting && isCurrent`:

   ```
   ┌─ Card: [billing] Billing revamp  [sub-plan]  depends on: auth-service ─┐
   │   scope: …                                                            │
   │   📄 6 files  ☑ 4 steps                              [✎ Refine sub-plan] │
   └────────────────────────────────────────────────────────────────────────┘
   ```

   Opens `PromptModal` seeded with the resolved `plan_subplan_refine` body (the developer-editable
   part only). `onRun` →
   `action("refine_plan", { prompt, promptIsBody: true, complex: true, branchRef: b.name })`.

2. **Prompt endpoint** — `GET /api/flows/[id]/prompt` gains `?branch=<name>`; when present it
   resolves `plan_subplan_refine` (with `appendsInternal: true`) instead of the plan templates,
   and additionally returns the **context block list** (§4: id, label, rendered preview, char
   count, default-on) so the PromptModal can render the picker.

3. **Diff banner** — after a scoped refine, above the branch cards:
   `billing refined: 2 steps changed, 1 added — view diff` (expandable old-vs-new step rows).

4. **Fresh-agent toggle** — a "New agent" chip beside the refine button (and a checkbox in the
   PromptModal): "start a clean agent instead of continuing the current one — lower
   hallucination risk from accumulated context; it only re-reads this branch's files."
   Composes with the model selector; defaults per §3.
5. **Context picker** — in the PromptModal below the textarea: block chips with checkboxes and
   per-block char counts (§4). The `contract` block is shown locked with a tooltip; the
   selection is sent as `contextBlocks` on the action call and re-assembled server-side (never
   trust client-assembled context).
6. **Chat scope chip (phase C)** — PlanView holds a selected-branch state; the chat composer shows
   a `refining: billing` chip and passes `branchRef` + `fresh` through the chat path. Unscoped
   chat feedback remains whole-plan. Requires plumbing `branchRef` through `node.chat()`.

## 8. Rendering the branch tab

Branch cards become expandable tabs; the selected branch renders its **own** document —
`b.markdown` when a scoped refine wrote one, else the relevant section of the plan markdown.
Plan-level markdown is only rewritten by full-plan refines, so the overview stays stable.

That immutability has a cost: after a scoped refine, the overview prose can lag the branch docs.
PlanView surfaces staleness instead of hiding it:

- Branch badge `● sub-plan refined v{n}` on cards whose `markdown` came from a `scopedRefine`
  version newer than the overview's version.
- A dismissible one-line note above the overview when **any** branch doc is newer:
  `branch sub-plans are more recent than this overview — open a branch tab for its current
  document`.

No copy change is needed in the approve banner: approval gates on the **steps**, which the merge
keeps current — only the prose overview lags. (Phase C, optional: a "sync overview" shortcut that
runs a full-plan refine for developers who want the prose refreshed.)

## 9. Edge cases

- `branchRef` on a **simple** plan or unknown branch name → fall back to whole-plan refine with a
  lifecycle note (never hard-fail the refine).
- Branch has **no `subPlan`** yet → still allowed; seed the modal/template from `scope` + `files`
  (empty `subPlanPrompt` / `currentSteps`), and on merge create the `subPlan`.
- Scoped response **fails validation after retry** → keep the previous artifact version, node
  `failed` with `validationErrors` (same semantics as today's malformed path, but scoped).
- Empty `feedback` + empty `prompt` → no-op error, as today.
- **Manual checklist edits**: solved in Phase A — `currentSteps` is built from the **live
  checklist rows** (§2), so hand edits are part of the refine's input and the model preserves
  them unless the feedback changes them. The scoped `replaceBranch` sync then replaces rows with
  echoed intent, not clobbered state. Rows of *other* branches are never touched by a scoped
  refine.
- Approval state: refining a branch keeps the plan `awaiting_approval`; `approve_plan` /
  `approve_build` behavior unchanged.
- **Fresh agent can't run ungrounded** — `contract` is pinned and `ticket`/`current` default on,
  so a fresh run always has at least contract + current steps + feedback, even with the picker
  emptied of optional blocks.
- **Follow-up + `fresh` conflict** — `fresh` wins: if set, `followUpOn` is null and the run is a
  new agent regardless of prior state; the UI should hide the toggle when no agent exists yet
  (first plan generation is always fresh).

## 10. Sequencing & risk

| Phase | Scope | Risk |
|---|---|---|
| A | Schema (incl. `branch: null \| branch-name`) + template + live-rows `currentSteps` + `buildPrompt` branch + `fresh`/`contextBlocks` input flags + id-preserving merge + per-mode scoped retry + scoped checklist sync | Med |
| B | Branch-card refine button, `?branch=` prompt param + context block list, picker + fresh-agent toggle UI, diff banner (id/title matching), staleness badges + overview note, branch tabs | Low-med |
| C | Chat scope chip, apply-on-confirm (pending proposal in meta, accept/reject UI), per-branch approval gating | Med |

**Note for 3C:** `subPlan.prompt` is currently only *displayed* — no node consumes it at build
time yet. This proposal gives it a real consumer (the scoped refine loop) and makes per-branch
markdown available for the future dedicated per-branch planning/build runs.
