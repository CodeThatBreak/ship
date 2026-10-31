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
const {
  PLAN_RESPONSE_JSON_SCHEMA,
  SUB_PLAN_RESPONSE_JSON_SCHEMA,
  SUB_PLAN_PATCH_JSON_SCHEMA,
  PlanTurnOutput,
  SubPlanPatch,
  PlanResponse,
  SubPlanResponse,
  withStepIds,
} = await import('./schema');
const { PlanNode } = await import('./plan-node');
const { db } = await import('../../../../db');
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
    expect(SUB_PLAN_PATCH_JSON_SCHEMA).toBeTypeOf('object');
    expect(JSON.stringify(SUB_PLAN_RESPONSE_JSON_SCHEMA)).toContain('"markdown"');
  });
});

describe('SubPlanPatch + PlanTurnOutput', () => {
  it('rejects an empty subPlanPatch', () => {
    expect(SubPlanPatch.safeParse({}).success).toBe(false);
  });

  it('rejects more than one publish field on PlanTurnOutput', () => {
    expect(
      PlanTurnOutput.safeParse({
        reply: 'hi',
        plan: { markdown: '# P', steps: [step('s1', 'A')] },
        subPlanPatch: { markdown: 'm' },
      }).success
    ).toBe(false);
  });

  it('accepts reply-only PlanTurnOutput', () => {
    expect(PlanTurnOutput.safeParse({ reply: 'clarifying question' }).success).toBe(true);
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

describe('PlanNode — chat via the follow-up contract (docs/plan-conversation-refine.md §3a–c)', () => {
  // real rows for `plan_steps` FKs (the checklist sync writes live rows in the
  // isolated DB — see chatNode's saveArtifact); `db` resolves above with the
  // other dynamic imports
  db.run(
    `INSERT OR IGNORE INTO tasks (id, type, key, summary, status, issue_type, priority)
     VALUES ('task_chat','generic','T-1','plan chat contract test','open','task','P2')`
  );
  db.run(
    `INSERT OR IGNORE INTO flows (id, task_id, name, status, created_at, updated_at)
     VALUES ('flow-1','task_chat','plan chat contract test','active',?,?)`,
    db.now(), db.now()
  );
  db.run(
    `INSERT OR IGNORE INTO nodes (id, flow_id, node_key, type, status, agent_id, created_at, updated_at)
     VALUES ('node-1','flow-1','plan','plan','awaiting_approval',NULL,?,?)`,
    db.now(), db.now()
  );

  const ctx = {
    flow: { id: 'flow-1' },
    task: { key: 'T-1' },
  } as unknown as FlowCtx;

  /** File-scope artifact id counter — each chatNode save needs a unique row id. */
  let chatArtifactSeq = 0;

  /* the LATEST plan artifact row the store sees — version 2, meta parsed like
   * artifact rows really are */
  const prevPlanRow = {
    id: 'art_1',
    version: 2,
    content: '# Plan document',
    meta: JSON.stringify({ steps: [step('s1', 'First', 'auth')], branches: [] }),
  };

  /** The stub harness: support journals artifact saves + node updates + events;
   *  the runner answers ONE turn per `executeRun` call from the response queue
   *  (and records both `startAgent` inputs and the run labels). */
  const chatNode = (opts: {
    responses: string[]; // one per expected agent turn
    status?: string;
    agentId?: string | null;
    promptRules?: string;
    /** the latest plan artifact the store sees (defaults to a version-2 plan) */
    prevRow?: { id: string; version: number; content: string; meta: string | null } | null;
  }) => {
    const observ = {
      startAgentInputs: [] as unknown as { prompt: string; mode: string; followUpOn: string | null; model: string | null }[],
      labels: [] as string[],
      savedMetas: [] as (Record<string, unknown> | null)[],
      savedContents: [] as string[],
      savedArts: [] as { id: string; version: number }[],
      nodePatches: [] as Record<string, unknown>[],
      events: [] as string[],
    };
    const support = {
      nodeByKey: (flowId: string, key: string) =>
        ({
          id: 'node-1',
          flow_id: flowId,
          node_key: key,
          status: opts.status ?? 'awaiting_approval',
          agent_id: null,
          config: JSON.stringify({ prompt_rules: opts.promptRules ?? '' }),
        }) as unknown as NodeRow,
      lastAgentId: () => opts.agentId ?? null,
      setNode: (_id: string, patch: Record<string, unknown>) => {
        observ.nodePatches.push(patch);
      },
      // REAL artifact persist (the isolated DB has task/flow/node rows seeded
      // below) so `persistPlan`'s checklist sync can write valid `plan_steps`
      // rows — with the meta/observability journal on top.
      saveArtifact(nodeId: string, flowId: string, kind: string, content: string, meta?: unknown) {
        observ.savedMetas.push((meta ?? null) as Record<string, unknown> | null);
        observ.savedContents.push(content);
        const prev = db.get<{ v: number | null }>(`SELECT MAX(version) v FROM artifacts WHERE node_id=? AND kind=?`, nodeId, kind);
        const version = (prev?.v ?? 0) + 1;
        const id = `art_chat_${String(++chatArtifactSeq)}`;
        db.run(
          `INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at)
           VALUES (?,?,?,?,?,?,?,'draft',?)`,
          id, nodeId, flowId, kind, version, content, meta ? JSON.stringify(meta) : null, db.now()
        );
        const art = { id, version };
        observ.savedArts.push(art);
        return art;
      },
      latestArtifact: () => (opts.prevRow === undefined ? prevPlanRow : opts.prevRow),
      artifactsOfKind: () => (opts.prevRow === undefined ? [{ id: 'art_1', version: 2, content: '# Plan document', meta: prevPlanRow.meta }] : []),
      emitLifecycle: (_flowId: string, _nodeId: string, message: string) => {
        observ.events.push(message);
      },
    } as unknown as NodeSupport;
    const runner = {
      startAgent: (_ctx: FlowCtx, input: unknown) => {
        observ.startAgentInputs.push(input as never);
        return Promise.resolve({ agentId: 'agent_1', runId: 'run_1' });
      },
      executeRun: (_ctx: FlowCtx, _nodeId: string, start: () => Promise<unknown>, label: string) => {
        observ.labels.push(label);
        return start().then(() => ({
          status: 'finished',
          result: responses.shift(),
          sessionId: 'session_1',
          durationMs: 1,
          usage: null,
        }));
      },
    } as unknown as AgentRunner;
      const responses = [...opts.responses];
    const node = new PlanNode(
      support as unknown as NodeSupport,
      runner as unknown as AgentRunner,
      {
        taskContext: () => 'TASK-1 context',
        taskLabel: () => 'task',
        execMode: () => 'cloud',
      } as unknown as FlowContextHelper
    );
    return { node, observ };
  };

  const validPlanPayload = {
    markdown: '# Plan (refined)',
    steps: [step('s1', 'First'), step('s2', 'Second')],
  };

  it('reply-only turn: the reply comes back; NO artifact, no status change, no checklist event, no version', async () => {
    const { node, observ } = chatNode({ responses: [JSON.stringify({ reply: 'Answered: step 2 is blocked.' })] });
    const reply = await node.chat(ctx, 'why is step 2 blocked?');
    expect(reply).toBe('Answered: step 2 is blocked.');
    expect(observ.savedMetas).toHaveLength(0);
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
    expect(observ.events).toHaveLength(0);
    expect(observ.startAgentInputs).toHaveLength(1);
    // the same-session follow-up turn, labelled as the conversation kind it is
    const turn = observ.startAgentInputs[0];
    expect(turn.mode).toBe('plan');
    expect(turn.followUpOn).toBeNull();
    expect(observ.labels).toEqual(['plan chat']);
  });

  it('plan-bearing turn: the reply flows AND the version lands through the refine path', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Moved step 2 below step 1.', plan: validPlanPayload })],
    });
    const reply = await node.chat(ctx, 'move step 2 below step 1');
    expect(reply).toBe('Moved step 2 below step 1.');
    // one new plan artifact version, with the conversation meta
    expect(observ.savedContents).toEqual(['# Plan (refined)']);
    const meta = observ.savedMetas[0] as Record<string, unknown>;
    expect(meta.feedback).toBe('move step 2 below step 1');
    expect(meta.refinedFrom).toEqual({ version: 2, source: 'chat' });
    expect(meta.executionSource).toBe('knob');
    // the node row landed exactly like a normal refine's outcome
    const art = observ.savedArts[0];
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
    expect(observ.nodePatches.find(p => p.output != null)?.output).toContain(art.id);
    expect(observ.events).toContain(`plan v${art.version} ready for review · 2 steps`);
    // the checklist synced from the plan payload (Id runs through the store's
    // real syncFromPlan into the live rows)
    const checklist = db.all<{ title: string }>(`SELECT title FROM plan_steps WHERE flow_id=? ORDER BY position`, 'flow-1');
    expect(checklist.map(r => r.title)).toEqual(['First', 'Second']);
  });

  it('an invalid plan: exactly ONE feedback retry turn, then a plain refusal — the node never becomes failed', async () => {
    const invalid = { ...validPlanPayload, steps: [step('s1', 'First'), step('s1', 'Again')] };
    const { node, observ } = chatNode({
      responses: [
        JSON.stringify({ reply: 'Fixed.', plan: invalid }),
        JSON.stringify({ reply: 'Fixed for real.', plan: invalid }),
      ],
    });
    const reply = await node.chat(ctx, 'dedupe the steps');
    expect(observ.startAgentInputs).toHaveLength(2); // the initial turn + ONE retry
    expect(observ.labels).toEqual(['plan chat', 'plan chat retry']);
    expect(observ.savedMetas).toHaveLength(0); // no partial version ever persisted
    expect(observ.events).toContain('plan chat output contract failed — retrying with feedback (schema_mismatch)');
    expect(observ.events).toContain('plan refine failed validation — nothing was changed');
    expect(reply).toContain("I couldn't produce a valid plan for that —");
    expect(reply).toContain('duplicate step id');
    expect(reply).toContain('nothing was changed');
  });

  it('the retry machine heals a valid second turn: the version lands, the reply carries', async () => {
    const invalid = { ...validPlanPayload, steps: [step('s1', 'First'), step('s1', 'Again')] };
    const { node, observ } = chatNode({
      responses: [
        JSON.stringify({ reply: 'Fixed.', plan: invalid }),
        JSON.stringify({ reply: 'Fixed for real.', plan: validPlanPayload }),
      ],
    });
    const reply = await node.chat(ctx, 'dedupe the steps');
    expect(reply).toBe('Fixed for real.');
    expect(observ.savedMetas).toHaveLength(1);
    expect((observ.savedMetas[0] as Record<string, unknown>).refinedFrom).toEqual({ version: 2, source: 'chat' });
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
  });

  it('the plan_refine feedback turn carries the developer message + user rules + the follow-up contract', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Answered.' })],
      promptRules: 'RULES',
    });
    await node.chat(ctx, 'why is step 2 blocked?');
    const turn = observ.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toContain('why is step 2 blocked?');
    expect(turn.prompt).toContain('The conversation continues');
    expect(turn.prompt).toContain('"reply"');
    expect(turn.prompt).toContain('RULES');
  });

  it('guard refusal per §3b: a running node keeps its state; the reply answers AND explains', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'On it.', plan: validPlanPayload })],
      status: 'running',
    });
    const reply = await node.chat(ctx, 'move step 2');
    expect(reply).toContain('On it.');
    expect(reply).toContain("can't update the plan while it is running");
    expect(observ.savedMetas).toHaveLength(0);
    expect(observ.events).toContain('plan update ignored — node running');
  });

  it('guard refusal per §3b: an approved plan refuses mid-build the same way', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Sure.', plan: validPlanPayload })],
      status: 'approved',
    });
    const reply = await node.chat(ctx, 'add a step');
    expect(reply).toContain("can't update the plan while it is approved");
    expect(observ.savedMetas).toHaveLength(0);
    expect(observ.events).toContain('plan update ignored — node approved');
  });

  it('a first apply on a pending node (not UI-reachable; contract-required) lands version 1 → awaiting_approval', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Planned.', plan: validPlanPayload })],
      status: 'pending',
      prevRow: null, // no plan yet: the FIRST apply
    });
    const reply = await node.chat(ctx, 'start this');
    expect(reply).toBe('Planned.');
    expect(observ.savedMetas).toHaveLength(1);
    // no previous version: the refine provenance records version 0
    expect((observ.savedMetas[0] as Record<string, unknown>).refinedFrom).toEqual({ version: 0, source: 'start' });
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
  });

  it('a failed node accepts the apply as the rescue path (§3b): status → awaiting_approval', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Recovered.', plan: validPlanPayload })],
      status: 'failed',
    });
    const reply = await node.chat(ctx, 'fix and re-plan');
    expect(reply).toBe('Recovered.');
    const art = observ.savedArts[0];
    expect(art).toBeDefined();
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
    expect(observ.events).toContain(`plan v${art.version} ready for review · 2 steps`);
  });
});

describe('PlanNode.turn — unified send routing', () => {
  const branchedPlanRow = {
    id: 'art_branch',
    version: 2,
    content: '# Plan document',
    meta: JSON.stringify({
      steps: metaWithTwoBranches().steps,
      branches: metaWithTwoBranches().branches,
    }),
  };

  let turnArtifactSeq = 0;

  const turnNode = (opts: { responses: string[]; prevRow?: typeof branchedPlanRow | null; output?: string }) => {
    const observ = {
      startAgentInputs: [] as { followUpOn: string | null }[],
      savedMetas: [] as Record<string, unknown>[],
      nodePatches: [] as Record<string, unknown>[],
    };
    const responses = [...opts.responses];
    const support = {
      nodeByKey: () =>
        ({
          id: 'node-1',
          flow_id: 'flow-1',
          node_key: 'plan',
          status: 'awaiting_approval',
          agent_id: 'whole_agent',
          output:
            opts.output ??
            ({
              latestArtifact: 'art_branch',
              version: 2,
              branchAgents: { billing: 'branch_agent' },
            } as Record<string, unknown>),
          config: JSON.stringify({ prompt_rules: '' }),
        }) as unknown as NodeRow,
      lastAgentId: () => 'agent_turn',
      setNode: (_id: string, patch: Record<string, unknown>) => {
        observ.nodePatches.push(patch);
      },
      latestArtifact: () => (opts.prevRow === undefined ? branchedPlanRow : opts.prevRow),
      artifactsOfKind: () => [branchedPlanRow],
      saveArtifact(nodeId: string, flowId: string, kind: string, content: string, meta?: unknown) {
        observ.savedMetas.push((meta ?? null) as Record<string, unknown>);
        const prev = db.get<{ v: number | null }>(`SELECT MAX(version) v FROM artifacts WHERE node_id=? AND kind=?`, nodeId, kind);
        const version = (prev?.v ?? 0) + 1;
        const id = `art_turn_${String(++turnArtifactSeq)}`;
        db.run(
          `INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at)
           VALUES (?,?,?,?,?,?,?,'draft',?)`,
          id,
          nodeId,
          flowId,
          kind,
          version,
          content,
          meta ? JSON.stringify(meta) : null,
          db.now()
        );
        return { id, version };
      },
      emitLifecycle: () => {},
    } as unknown as NodeSupport;
    const runner = {
      startAgent: (_ctx: FlowCtx, input: unknown) => {
        observ.startAgentInputs.push(input as { followUpOn: string | null });
        return Promise.resolve({ agentId: 'agent_turn', runId: 'run_1' });
      },
      executeRun: (_ctx: FlowCtx, _nodeId: string, start: () => Promise<unknown>) =>
        start().then(() => ({
          status: 'finished',
          result: responses.shift(),
          sessionId: 's',
          durationMs: 1,
          usage: null,
        })),
    } as unknown as AgentRunner;
    const node = new PlanNode(
      support,
      runner,
      { taskContext: () => 'ctx', taskLabel: () => 'task', execMode: () => 'cloud' } as unknown as FlowContextHelper
    );
    return { node, observ };
  };

  const ctx = { flow: { id: 'flow-1' }, task: { key: 'T-1' } } as unknown as FlowCtx;

  it('throws for an unknown branch thread', async () => {
    const { node } = turnNode({ responses: [] });
    await expect(node.turn(ctx, 'hello', { thread: 'ghost' })).rejects.toThrow('branch "ghost" not found');
  });

  it('branch reply-only: no artifact write', async () => {
    const { node, observ } = turnNode({ responses: [JSON.stringify({ reply: 'scoped answer' })] });
    const reply = await node.turn(ctx, 'question', { thread: 'billing' });
    expect(reply).toBe('scoped answer');
    expect(observ.savedMetas).toHaveLength(0);
    expect(observ.startAgentInputs[0]?.followUpOn).toBe('branch_agent');
  });

  it('rejects whole plan payload on branch turns after retry', async () => {
    const planPayload = { markdown: '# P', steps: [step('s1', 'Only')] };
    const { node } = turnNode({
      responses: [
        JSON.stringify({ reply: 'nope', plan: planPayload }),
        JSON.stringify({ reply: 'still nope', plan: planPayload }),
      ],
    });
    const reply = await node.turn(ctx, 'change billing', { thread: 'billing' });
    expect(reply).toContain("couldn't produce a valid plan");
  });

  it('applies subPlanPatch on a branch thread', async () => {
    const { node, observ } = turnNode({
      responses: [
        JSON.stringify({
          reply: 'patched billing step',
          subPlanPatch: { upsertSteps: [{ ...step('s4', 'Billing invoice'), detail: 'via patch' }] },
        }),
      ],
    });
    const reply = await node.turn(ctx, 'tweak invoice step', { thread: 'billing' });
    expect(reply).toBe('patched billing step');
    expect(observ.savedMetas).toHaveLength(1);
    const meta = observ.savedMetas[0] as { steps: PlanStep[] };
    expect(meta.steps.find(s => s.id === 's4' && s.branch === 'billing')?.detail).toBe('via patch');
  });
});
