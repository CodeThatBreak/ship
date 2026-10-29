/**
 * A dummy walkthrough of the plan node's split source port (Phase 6): a plan
 * artifact the planner published with a BRANCH decomposition + the execution
 * "steps" decision (follow knob), fed through the REAL {@link PlanSplitter}
 * with a stubbed store (the only call it makes is latestPlan — no DB needed).
 *
 * Sections mirror what happens at run time:
 *   1. the dummy plan artifact (markdown + published execution meta);
 *   2. splitUnits — one SplitUnit per branch, the contract the split runtime
 *      turns into one child build flow (the item carries the full plan doc);
 *   3. splitResolution — the recommendation the build consumer honors with
 *      its default split_consume: "source" knob, per execution knob;
 *   4. the branch DAG as scheduling waves + the child trigger payload.
 *
 * Run: npx vitest run lib/engine/nodes/kinds/plan/plan-split-units-demo.test.ts
 */
import { describe, expect, it } from 'vitest';
import type { PlanMeta } from './schema';
import { PlanSplitter } from './plan-split';
import type { PlanStore } from './plan-store';
import type { ExecutionKnob } from './plan-prompt';
import type { FlowCtx } from '../../shared';
import type { LatestPlan } from './types';

// ── 1. the dummy plan artifact ───────────────────────────────────────────────
// What PlanStore.persistPlan leaves in artifacts.meta after the planner's
// response in follow mode: checklist steps + branches + the published
// execution decision ("steps" = one child flow per branch on approval).

const PLAN_DOCUMENT = `# Plan — Payments revamp (v3)

## Checklist
- [ ] s1 Auth token service (auth)
- [ ] s2 Billing usage table (billing)
- [ ] s3 Invoice mailer (billing)
- [ ] s4 Deploy runbook (deploy)

## Branches
- auth — logins, files: src/lib/auth.ts
- billing — invoices, files: src/lib/billing.ts (depends on auth)
- deploy — ops manual, files: runbook.md (depends on billing)
`;

const planMeta: PlanMeta = {
  steps: [
    { id: 's1', title: 'Auth token service', detail: 'issue + verify', files: ['src/lib/auth.ts'], branch: 'auth' },
    { id: 's2', title: 'Billing usage table', detail: 'sqlite table + mapper', files: ['src/lib/billing.ts'], branch: 'billing' },
    { id: 's3', title: 'Invoice mailer', detail: 'send after invoice', files: ['src/lib/billing.ts'], branch: 'billing' },
    { id: 's4', title: 'Deploy runbook', detail: 'release steps', files: ['runbook.md'], branch: 'deploy' },
  ],
  branches: [
    { name: 'auth', title: 'Auth', scope: 'logins', files: ['src/lib/auth.ts'], steps: ['s1'], dependsOn: [] },
    {
      name: 'billing',
      title: 'Billing',
      scope: 'invoices',
      files: ['src/lib/billing.ts'],
      steps: ['s2', 's3'],
      dependsOn: ['auth'],
    },
    {
      name: 'deploy',
      title: 'Deploy',
      scope: 'ops manual',
      files: ['runbook.md'],
      steps: ['s4'],
      dependsOn: ['billing'],
      subPlan: { prompt: 'draft the deploy runbook', steps: [] }, // seeded by a scoped refine
    },
  ],
};

// The execution decision rides every plan version (artifacts.meta) — here the
// PLANNER decided per-branch fan-out under the follow knob:
const rawMeta = {
  execution: 'steps',
  executionSource: 'planner',
  execution_rationale: '5+ independent branches a reviewer can verify one at a time',
};

const latest: LatestPlan = {
  art: { id: 'art_plan', version: 3, content: PLAN_DOCUMENT },
  meta: planMeta,
  rawMeta,
};

const ctxWith = (knob: ExecutionKnob): FlowCtx => ({ flow: { id: 'flow-1', knob } }) as unknown as FlowCtx;

// The same wiring the plan node uses at run time; the store is the only stub.
const knobOf = (ctx: FlowCtx): ExecutionKnob => ((ctx.flow as { knob?: string }).knob === 'follow' ? 'follow' : 'whole');
const splitter = new PlanSplitter({ latestPlan: () => latest } as unknown as PlanStore, knobOf);

describe('dummy walkthrough — a branched plan through the split source port', () => {
  it('1 · the plan artifact: branches scheduled purely by the branch DAG', () => {
    // depth 1 = auth, depth 2 = billing, depth 3 = deploy
    expect(latest.meta.branches.map(b => `${b.name} dependsOn [${b.dependsOn.join(',')}]`)).toEqual([
      'auth dependsOn []',
      'billing dependsOn [auth]',
      'deploy dependsOn [billing]',
    ]);
    expect(latest.rawMeta).toMatchObject({ execution: 'steps', executionSource: 'planner' });
  });

  it('2 · splitUnits: one SplitUnit per branch — what each child build flow receives', () => {
    const units = splitter.units(ctxWith('follow'));
    if (!units) throw new Error('a plan with branches must yield split units');

    console.log('── SplitUnit[] (one unit per branch, target: build) ──');
    console.log(JSON.stringify(units, null, 2));

    expect(units.map(u => u.key)).toEqual(['auth', 'billing', 'deploy']);
    expect(units[2].dependsOn).toEqual(['billing']);
    // the run target + the item shape the child build run renders in
    expect(units.every(u => u.target === 'build')).toBe(true);
    expect(units[2].item).toEqual({
      name: 'deploy',
      title: 'Deploy',
      scope: 'ops manual',
      files: ['runbook.md'],
      dependsOn: ['billing'],
      subPlan: { prompt: 'draft the deploy runbook', steps: [] },
      markdown: null,
      plan: PLAN_DOCUMENT, // the FULL plan document rides every unit
    });
  });

  it('3 · splitResolution: what the build consumer honors (split_consume: "source")', () => {
    expect(splitter.resolution(ctxWith('whole'))).toBe('whole');
    expect(splitter.resolution(ctxWith('follow'))).toBe('per-unit'); // published "steps" ⇒ per-branch fan-out
    // legacy "steps" knob configs degrade to whole (the retired mapping);
    // the approve_plan override writes executionSource "override" into the
    // same meta and is honored the same way at approve time

     
    console.log('\n── splitResolution (knob → recommendation) ──');
     
    console.log('  knob whole:        whole');
     
    console.log('  knob follow:       per-unit (published "steps")');
     
    console.log('  legacy steps knob: whole (retired per-step config → default)');
     
    console.log('  approve override:  executionSource "override" in the same meta');
  });

  it('4 · after approval: the branch DAG as scheduling waves + the child payload', () => {
    const units = splitter.units(ctxWith('follow'));
    if (!units) throw new Error('a plan with branches must yield split units');
    const done = new Set<string>();
    const waves: number[][] = [];
    while (done.size < units.length) {
      const ready = units.filter(u => !done.has(u.key) && u.dependsOn.every(d => done.has(d)));
      if (!ready.length) break;
      waves.push(ready.map(u => u.key));
      ready.forEach(u => done.add(u.key));
    }
    expect(waves).toEqual([['auth'], ['billing'], ['deploy']]);

    console.log('\n── the split runtime (split-manager) consumes the units ──');
    console.log(`  waves: ${waves.map((w, i) => `wave ${i + 1}: ${w.join(', ')}`).join(' → ')}`);
    console.log('  per unit → flowEngine.createSplitChild: ONE real child flow whose');
    console.log('    trigger_payload = { parentNodeKey: "build", unit: { key, title, dependsOn, item, position } }');
    console.log('    the child renders the payload as {{input.unit.*}} and delivers back into the parent');
    console.log('  join: one aggregate entry per unit in expansion order (DEFAULT_SPLIT_OUTPUT),');
    console.log('    worst-of statuses (failed > awaiting_approval > done)');
  });
});
