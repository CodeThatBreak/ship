/**
 * Plan-node domain pieces on the agent-node infrastructure: the ONE response
 * schema (plan-domain rules as refinements, carrying the old validator
 * messages verbatim — the retry feedback text depends on them), the
 * deterministic scoped-refine merge/diff, and the generated output-contract
 * schemas.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database). The imports hoist it —
 * dynamic imports keep the order.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-node-')), 'test.db');

// the registry instantiates every builtin on first load — resolve its import
// cycle from here (not from a mid-evaluation node class) so all classes are
// fully initialized before plan-node is imported
await import('../../registry');
const { BranchRefinement } = await import('./branch-refinement');
const { PLAN_RESPONSE_JSON_SCHEMA, SUB_PLAN_RESPONSE_JSON_SCHEMA, PlanResponse, SubPlanResponse, withStepIds } =
  await import('./schema');
const { PlanNode } = await import('./plan-node');
type PlanNodeInstance = InstanceType<typeof PlanNode>;
import type { PlanBranch, PlanMeta, PlanStep } from './schema';
import type { FlowCtx, FlowContextHelper } from '../../shared';
import type { NodeSupport } from '../../shared/node-support';
import type { AgentRunner } from '../../../harness';
import type { NodeRow } from '../../../../db/rows';

/** Messages of a schema's violations for one payload. */
const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map(i => i.message);

const step = (id: string, title: string, branch: string | null = null): PlanStep => ({
  id,
  title,
  detail: 'd',
  files: ['f.ts'],
  branch,
});

const metaWithTwoBranches = (): PlanMeta => ({
  steps: [
    step('s1', 'Auth service', 'auth'),
    step('s2', 'Billing table', 'billing'),
    step('s3', 'Auth tokens', 'auth'),
    step('s4', 'Billing invoice', 'billing'),
  ],
  branches: [
    {
      name: 'auth',
      title: 'Auth',
      scope: 'logins',
      files: ['a.ts'],
      steps: ['Auth service', 'Auth tokens'],
      dependsOn: [],
    },
    {
      name: 'billing',
      title: 'Billing',
      scope: 'invoices',
      files: ['b.ts'],
      steps: ['Billing table', 'Billing invoice'],
      dependsOn: ['auth'],
      subPlan: { prompt: 'do billing stuff', steps: [] },
    },
  ],
});

/** s2 unchanged, s4 reworded + file added, s5 added, s3 re-emitted (collides
 *  with a kept auth step → the merge must re-id it). */
const billingRefine = {
  markdown: '## Billing sub-plan (refined)',
  steps: [
    step('s2', 'Billing table'),
    { ...step('s4', 'Billing invoice'), detail: 'd4-revised', files: ['b.ts', 'c.ts'] },
    step('s5', 'Stripe sync'),
    step('s3', 'Echo collision'),
  ],
};

describe('PlanResponse — the one plan schema (plan rules as refinements)', () => {
  const valid = {
    markdown: '# Plan',
    steps: [step('s1', 'First'), step('s2', 'Second')],
  };

  it('accepts a branchless plan', () => {
    expect(PlanResponse.safeParse(valid).success).toBe(true);
  });

  it('accepts a branched plan with resolvable cross-references', () => {
    const branched = {
      ...valid,
      branches: [
        { name: 'auth', title: 'Auth', files: [], steps: [], dependsOn: [] },
        { name: 'billing', title: 'Billing', files: [], steps: [], dependsOn: ['auth'] },
      ],
    };
    expect(PlanResponse.safeParse(branched).success).toBe(true);
  });

  it('rejects duplicate branch names — the old validator message', () => {
    const msgs = messagesOf(
      PlanResponse.safeParse({
        ...valid,
        branches: [
          { name: 'auth', title: 'A', files: [], steps: [], dependsOn: [] },
          { name: 'auth', title: 'A again', files: [], steps: [], dependsOn: [] },
        ],
      })
    );
    expect(msgs).toContain('duplicate branch name "auth"');
  });

  it('rejects dependsOn references to unknown branches — the old validator message', () => {
    const msgs = messagesOf(
      PlanResponse.safeParse({
        ...valid,
        branches: [{ name: 'auth', title: 'A', files: [], steps: [], dependsOn: ['nope'] }],
      })
    );
    expect(msgs).toContain('dependsOn references unknown branch "nope"');
  });

  it('rejects steps referencing unknown branches — the old validator message', () => {
    const msgs = messagesOf(
      PlanResponse.safeParse({
        markdown: '# Plan',
        steps: [step('s1', 'First', 'ghost')],
        branches: [{ name: 'auth', title: 'A', files: [], steps: [], dependsOn: [] }],
      })
    );
    expect(msgs).toContain('step "s1" references unknown branch "ghost"');
  });

  it('rejects duplicate step ids — the old validator message', () => {
    const msgs = messagesOf(
      PlanResponse.safeParse({
        ...valid,
        steps: [step('s1', 'First'), step('s1', 'Again')],
      })
    );
    expect(msgs).toContain('duplicate step id "s1"');
  });

  it('withStepIds fills missing ids in order (s1, s2, …)', () => {
    const filled = withStepIds([
      { title: 'First', detail: '', files: [], branch: null },
      { title: 'Second', detail: '', files: [], branch: null },
    ]);
    expect(filled.map(s => s.id)).toEqual(['s1', 's2']);
  });
});

describe("SubPlanResponse — the scoped refine's contract", () => {
  it('rejects an empty step list', () => {
    expect(SubPlanResponse.safeParse({ markdown: 'm', steps: [] }).success).toBe(false);
  });

  it('tolerates an agent echoing a foreign branch name — merge forces it', () => {
    const parsed = SubPlanResponse.safeParse({
      markdown: 'm',
      steps: [{ title: 't', detail: 'd', files: [], branch: 'other-branch' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.steps[0].branch).toBe('other-branch');
  });
});

describe('mergeBranchRefine — deterministic scoped merge (§5)', () => {
  it("splices the branch's new steps in place and re-ids collisions", () => {
    const merged = BranchRefinement.merge(metaWithTwoBranches(), 'billing', billingRefine);
    const ids = merged.steps.map(s => s.id);

    // global order preserved; auth steps untouched at their positions
    expect(ids[0]).toBe('s1');
    expect(ids[ids.length - 1]).toBe('s3');
    // no duplicate ids after the merge; the colliding "s3" was re-id'd
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[4]).not.toBe('s3');
  });

  it('updates the branch record and preserves the sub-plan prompt', () => {
    const merged = BranchRefinement.merge(metaWithTwoBranches(), 'billing', billingRefine);
    const billing = merged.branches.find(b => b.name === 'billing');
    expect(billing).toBeDefined();
    expect(billing?.markdown).toBe(billingRefine.markdown);
    expect(billing?.subPlan?.prompt).toBe('do billing stuff');
    expect(billing?.subPlan?.steps).toHaveLength(4);
    // every merged billing step carries the forced branch name
    expect(merged.steps.filter(s => s.branch === 'billing')).toHaveLength(4);
  });

  it('leaves other branches byte-identical', () => {
    const meta = metaWithTwoBranches();
    const merged = BranchRefinement.merge(meta, 'billing', billingRefine);
    expect(JSON.stringify(merged.branches[0])).toBe(JSON.stringify(meta.branches[0]));
    expect(merged.steps.filter(s => s.branch === 'auth')).toEqual(meta.steps.filter(s => s.branch === 'auth'));
  });

  it('throws on an unknown branch name', () => {
    expect(() => BranchRefinement.merge(metaWithTwoBranches(), 'ghost', billingRefine)).toThrow();
  });
});

describe('diffBranchSteps — id-based with a title fallback (§6)', () => {
  it('classifies added/removed/changed against the id-preserving merge', () => {
    const meta = metaWithTwoBranches();
    const merged = BranchRefinement.merge(meta, 'billing', billingRefine);
    const oldSteps = meta.steps.filter(s => s.branch === 'billing');
    const newSteps = merged.steps.filter(s => s.branch === 'billing');
    const diff = BranchRefinement.diffSteps(oldSteps, newSteps);
    // s2 unchanged (kept id), s4 changed, s5 added, collision re-id'd → added
    expect(diff.changed.map(c => c.id)).toEqual(['s4']);
    expect(diff.removed).toHaveLength(0);
    expect(diff.added.map(s => s.title).sort()).toEqual(['Echo collision', 'Stripe sync']);
  });

  it('promotes a renamed id on unchanged content to changed via the title fallback', () => {
    const diff = BranchRefinement.diffSteps(
      [
        { id: 'w1', title: 'Same work', detail: 'x', files: [], branch: null },
        { id: 'w2', title: 'Other', detail: 'y', files: [], branch: null },
      ],
      [
        { id: 'zz9', title: 'Same work', detail: 'x', files: [], branch: null },
        { id: 'w2', title: 'Other', detail: 'y', files: [], branch: null },
      ]
    );
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].id).toContain('w1');
  });
});

describe('the generated output-contract schemas', () => {
  it('renders both contracts as JSON Schema objects (recursion included)', () => {
    expect(PLAN_RESPONSE_JSON_SCHEMA).toBeTypeOf('object');
    expect(SUB_PLAN_RESPONSE_JSON_SCHEMA).toBeTypeOf('object');
    expect(JSON.stringify(SUB_PLAN_RESPONSE_JSON_SCHEMA)).toContain('"markdown"');
  });
});

describe('PlanResponse — branch dependency DAG (Phase 6)', () => {
  const base = {
    markdown: '# Plan',
    steps: [step('s1', 'First'), step('s2', 'Second')],
  };
  const branch = (name: string, dependsOn: string[]) => ({
    name,
    title: name,
    files: [],
    steps: [],
    dependsOn,
  });

  it('rejects a branch dependency cycle (auth → billing → auth) — the retry feedback message', () => {
    const msgs = messagesOf(
      PlanResponse.safeParse({
        ...base,
        branches: [branch('auth', ['billing']), branch('billing', ['auth'])],
      })
    );
    expect(msgs).toContain('branch dependency cycle: auth → billing → auth');
  });

  it('accepts a diamond branch DAG (a→b, a→c, b→d, c→d)', () => {
    expect(
      PlanResponse.safeParse({
        ...base,
        branches: [branch('a', []), branch('b', ['a']), branch('c', ['a']), branch('d', ['b', 'c'])],
      }).success
    ).toBe(true);
  });
});

describe('PlanNode — the split source port (Phase 6: branches are the units)', () => {
  /** A stub support whose latest plan artifact is `row` and whose plan node
   *  config snapshot carries `knob` — everything else these paths touch is
   *  never called. */
  const planNodeWith = (
    knob: string,
    row: { id: string; version: number; content: string; meta: string | null } | null
  ): PlanNodeInstance =>
    new PlanNode(
      {
        latestArtifact: () => row,
        nodeByKey: (flowId: string, key: string) =>
          ({
            id: 'node-1',
            flow_id: flowId,
            node_key: key,
            config: JSON.stringify({ execution_default: knob }),
          }) as unknown as NodeRow,
      } as unknown as NodeSupport,
      {} as unknown as AgentRunner,
      {} as unknown as FlowContextHelper
    );

  const ctx = { flow: { id: 'flow-1' } } as unknown as FlowCtx;

  const branches: PlanBranch[] = [
    { name: 'auth', title: 'Auth', scope: 'logins', files: ['a.ts'], steps: [], dependsOn: [] },
    {
      name: 'billing',
      title: 'Billing',
      scope: 'invoices',
      files: ['b.ts'],
      steps: [],
      dependsOn: ['auth'],
      subPlan: { prompt: 'do billing' },
      markdown: '## billing',
    },
  ];
  const planRow = (meta: Record<string, unknown>) => ({
    id: 'art_1',
    version: 3,
    content: '# Plan document',
    meta: JSON.stringify({
      steps: [step('s1', 'Auth service', 'auth')],
      ...meta,
    }),
  });

  it('splitUnits: one unit per branch — key/title/dependsOn, target build, item carries name + plan', () => {
    const units = planNodeWith('whole', planRow({ branches })).splitUnits(ctx);
    if (!units) throw new Error('expected split units');
    expect(units.map(u => u.key)).toEqual(['auth', 'billing']);
    expect(units.map(u => u.title)).toEqual(['Auth', 'Billing']);
    expect(units[0].dependsOn).toEqual([]);
    expect(units[1].dependsOn).toEqual(['auth']);
    expect(units.every(u => u.target === 'build')).toBe(true);
    const item = units[1].item as {
      name: string;
      title: string;
      scope: string;
      files: string[];
      subPlan: { prompt: string } | null;
      markdown: string | null;
      plan: string;
    };
    expect(item.name).toBe('billing');
    expect(item.plan).toBe('# Plan document');
    expect(item.subPlan?.prompt).toBe('do billing');
    expect(item.markdown).toBe('## billing');
  });

  it('splitUnits: null for a branch-less plan', () => {
    expect(planNodeWith('whole', planRow({ branches: [] })).splitUnits(ctx)).toBeNull();
  });

  it('splitUnits: null with no plan artifact', () => {
    expect(planNodeWith('whole', null).splitUnits(ctx)).toBeNull();
  });

  it('splitResolution: knob whole → whole', () => {
    expect(planNodeWith('whole', planRow({ branches, execution: 'whole' })).splitResolution(ctx)).toBe('whole');
  });

  it('splitResolution: legacy "steps" knob config → whole (the legacy fan-out is retired)', () => {
    expect(planNodeWith('steps', planRow({ branches, execution: 'whole' })).splitResolution(ctx)).toBe('whole');
  });

  it('splitResolution: follow + published steps → per-unit', () => {
    expect(planNodeWith('follow', planRow({ branches, execution: 'steps' })).splitResolution(ctx)).toBe('per-unit');
  });

  it('splitResolution: follow + published whole → whole', () => {
    expect(planNodeWith('follow', planRow({ branches, execution: 'whole' })).splitResolution(ctx)).toBe('whole');
  });

  it('splitResolution: follow with nothing published / no artifact → whole', () => {
    expect(planNodeWith('follow', planRow({ branches })).splitResolution(ctx)).toBe('whole');
    expect(planNodeWith('follow', null).splitResolution(ctx)).toBe('whole');
  });
});
