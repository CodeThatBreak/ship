/**
 * PlanScopedOutcome — the branch-scoped refine's tail: one branch merged or
 * patched into a NEW artifact version, only that branch's step rows replaced
 * (other branches untouched), and the awaiting-approval outcome whose blob
 * points at the fresh version.
 *
 * Shared dockerized test database (AGENTS.md §1 — truncated per file);
 * `saveArtifact` is a stub so the publish is observable, while the branch
 * checklist replace runs against real `plan_steps` rows (FK to artifacts).
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from 'vitest';
import { assignTestDatabase, resetTestDatabase } from '../../../../../tests/helpers/testDatabase';

assignTestDatabase();

beforeAll(resetTestDatabase);

const { planSteps } = await import('../../../runtime/planStepStore');
const { PlanScopedOutcome } = await import('./planScopedOutcome');
const { REFINED_FROM_SOURCE } = await import('./constants/refine');
import type { NodeSupport } from '../../shared/nodeSupport';
import type { FlowCtx } from '../../shared/nodeSharedExports';
import type { NodeRow } from '../../../../db/rows';
import type { ScopedRefine } from './types/planTypeExports';

const FLOW_ID = 'flow-1';
const now = () => new Date().toISOString();

const coreBranch = { name: 'core', title: 'Core', scope: '', files: [], steps: ['Core step'], dependsOn: [] };
const authBranch = { name: 'auth', title: 'Auth', scope: '', files: [], steps: ['Old auth step'], dependsOn: [] };

const makeScoped = (): ScopedRefine =>
  ({
    latest: {
      art: { id: 'art_old', version: 3, content: '# P' },
      meta: {
        steps: [
          { id: 's1', title: 'Old auth step', detail: '', files: [], branch: 'auth' },
          { id: 's2', title: 'Core step', detail: '', files: [], branch: 'core' },
        ],
        branches: [coreBranch, authBranch],
      },
      rawMeta: { planVersion: 3 },
    },
    branch: authBranch,
    liveRows: [],
  }) as never;

const makeOutcome = () => {
  const saved: { nodeId: string; flowId: string; kind: string; content: string; meta?: unknown }[] = [];
  const support = {
    saveArtifact: (nodeId: string, flowId: string, kind: string, content: string, meta?: unknown) => {
      saved.push({ nodeId, flowId, kind, content, meta });
      return { id: 'art_new', version: 4 };
    },
  } as unknown as NodeSupport;
  return { outcome: new PlanScopedOutcome(support), saved };
};

const ctx = { flow: { id: FLOW_ID } } as unknown as FlowCtx;
const node = { id: 'node-1' } as unknown as NodeRow;

beforeAll(async () => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    'task_1',
    'generic',
    'TST-1',
    'plan scoped outcome',
    'open',
    'task',
    'P2'
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    FLOW_ID,
    'task_1',
    'flow',
    'active',
    now(),
    now()
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    'node-1',
    FLOW_ID,
    'plan',
    'plan',
    'awaiting_approval',
    now(),
    now()
  );
  for (const id of ['art_old', 'art_new']) {
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES ($1,$2,$3,'plan',1,'# P',NULL,'draft',$4)`,
      id,
      'node-1',
      FLOW_ID,
      now()
    );
  }
});

describe('PlanScopedOutcome.subPlanOutcome', () => {
  it('publishes a new version with scoped provenance, replaces only the branch rows, other branches untouched', async () => {
    // seed the live checklist: one row per branch against the previous version
    await planSteps.replaceBranch(FLOW_ID, 'art_old', 'core', [{ id: 's2', title: 'Core step' }]);
    await planSteps.replaceBranch(FLOW_ID, 'art_old', 'auth', [{ id: 's1', title: 'Old auth step' }]);

    const { outcome, saved } = makeOutcome();
    const result = await outcome.subPlanOutcome(ctx, node, makeScoped(), {
      markdown: '## auth refined',
      steps: [{ title: 'New auth step', detail: '', files: [], branch: null }],
    });

    expect(result.status).toBe('awaiting_approval');
    expect(result.reply).toBe('## auth refined');
    expect(result.event).toBe("branch 'auth' sub-plan refined · 1 steps (+0 / −0, 1 changed) — other branches untouched");
    expect(result.output).toMatchObject({
      latestArtifact: 'art_new',
      version: 4,
      scopedRefine: { branch: 'auth', from: 3 },
    });

    // the artifact re-publishes the whole-plan markdown verbatim + provenance
    expect(saved[0]?.content).toBe('# P');
    const meta = saved[0]?.meta as { refinedFrom: { version: number; source: string }; scopedRefine: { from: number } };
    expect(meta.refinedFrom).toEqual({ version: 3, source: REFINED_FROM_SOURCE.BRANCH });
    expect(meta.scopedRefine).toEqual({ branch: 'auth', from: 3 });

    // the branch rows were replaced; the core branch's row survived untouched
    const rows = await planSteps.list(FLOW_ID);
    const authRows = rows.filter(r => r.branch === 'auth');
    expect(authRows).toHaveLength(1);
    expect(authRows[0]?.title).toBe('New auth step');
    expect(authRows[0]?.artifactId).toBe('art_new');
    const coreRows = rows.filter(r => r.branch === 'core');
    expect(coreRows).toHaveLength(1);
    expect(coreRows[0]?.artifactId).toBe('art_old');
  });
});

describe('PlanScopedOutcome.patchOutcome', () => {
  it('applies a change-only patch and falls back to the default reply when no markdown', async () => {
    await planSteps.replaceBranch(FLOW_ID, 'art_new', 'auth', [{ id: 's1', title: 'Old auth step' }]);

    const { outcome, saved } = makeOutcome();
    const result = await outcome.patchOutcome(ctx, node, makeScoped(), {
      upsertSteps: [{ id: 's1', title: 'Old auth step', detail: 'via patch', files: [], branch: null }],
    });

    expect(result.status).toBe('awaiting_approval');
    expect(result.reply).toBe('Updated branch "auth".');
    expect(result.event).toBe("branch 'auth' sub-plan patched · 1 steps (+0 / −0, 1 changed) — other branches untouched");
    expect(result.output).toMatchObject({ latestArtifact: 'art_new', version: 4, scopedRefine: { from: 3 } });
    const meta = saved[0]?.meta as { refinedFrom: { source: string } };
    expect(meta.refinedFrom.source).toBe(REFINED_FROM_SOURCE.BRANCH);

    const rows = await planSteps.list(FLOW_ID);
    const authRows = rows.filter(r => r.branch === 'auth');
    expect(authRows).toHaveLength(1);
    expect(authRows[0]?.detail).toBe('via patch');
  });
});
