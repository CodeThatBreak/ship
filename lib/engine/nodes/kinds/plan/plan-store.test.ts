/**
 * PlanStore — the latest-plan/meta parsing, the scoped-refine bundle, the
 * planner-execution normalization, and the two plan-version publish paths.
 *
 * Isolated temp SQLite DB (AGENTS.md §1); class instances get a stub
 * NodeSupport so the store's calls are observable without touching real rows
 * (the plan_steps sync itself is covered by the runtime's own tests).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-store-')), 'test.db');

await import('../../registry');
const { PlanStore } = await import('./plan-store');
import type { PlanStore as PlanStoreT } from './plan-store';
import type { PlanBranch, PlanMeta, PlanStep } from './schema';
import type { FlowCtx, NodeSupport } from '../../shared';
import type { NodeRow } from '../../../../db/rows';

const step = (id: string, title: string, branch: string | null = null): PlanStep => ({
  id,
  title,
  detail: 'd',
  files: ['f.ts'],
  branch,
});

const branch = (name: string, dependsOn: string[] = [], scope = ''): PlanBranch => ({
  name,
  title: name,
  scope,
  files: [],
  steps: [],
  dependsOn,
});

/** A stub support: `latestArtifact` is `row`; every other method is never called. */
const supportWith = (row: { id: string; version: number; content: string; meta: string | null } | null) =>
  ({
    latestArtifact: () => row,
    saveArtifact: (nodeId: string, flowId: string, kind: string, content: string, meta?: unknown) => {
      savedMetas?.push({ nodeId, flowId, kind, content, meta });
      return { id: 'art_new', version: 9 };
    },
  }) as unknown as NodeSupport;

let savedMetas: { nodeId: string; flowId: string; kind: string; content: string; meta?: unknown }[] | null = null;

const ctx = { flow: { id: 'flow-1' } } as unknown as FlowCtx;
const node = { id: 'node-1' } as unknown as NodeRow;
const artRow = (meta: unknown) => ({
  id: 'art_1',
  version: 3,
  content: '# Plan document',
  meta: typeof meta === 'string' ? meta : meta == null ? null : JSON.stringify(meta),
});

const metaOf = (callIndex: number) => (savedMetas ?? [])[callIndex]?.meta as Record<string, unknown> | undefined;

describe('PlanStore.latestPlan — parse + degrade', () => {
  it('returns null without an artifact', () => {
    expect(new PlanStore(supportWith(null)).latestPlan('flow-1')).toBeNull();
  });

  it('parses steps + branches from valid meta', () => {
    const latest = new PlanStore(supportWith(artRow({ steps: [step('s1', 'A', 'b')], branches: [branch('b')] }))).latestPlan('flow-1');
    expect(latest).not.toBeNull();
    expect(latest?.meta.steps).toHaveLength(1);
    expect(latest?.meta.branches).toHaveLength(1);
    expect(latest?.art).toEqual({ id: 'art_1', version: 3, content: '# Plan document' });
  });

  it('degrades garbage meta to an empty (branchless) plan — never throws', () => {
    const store = new PlanStore(supportWith(artRow('{not json')));
    const latest = store.latestPlan('flow-1');
    expect(latest).not.toBeNull();
    expect(latest?.meta).toEqual({ steps: [], branches: [] });
  });

  it('parses branches-only meta with empty steps (Zod defaults)', () => {
    const stores = new PlanStore(supportWith(artRow({ branches: [branch('b')] })));
    expect(stores.latestPlan('flow-1')?.meta).toEqual({ steps: [], branches: [branch('b')] });
    const branchless = new PlanStore(supportWith(artRow({ steps: [step('s1', 'A')] })));
    expect(branchless.latestPlan('flow-1')?.meta.branches).toEqual([]);
  });
});

describe('PlanStore.scopedRefine — the ref-count bundle or null', () => {
  const full = () =>
    new PlanStore(
      supportWith(artRow({ steps: [step('s1', 'A', 'auth'), step('s2', 'B', 'billing')], branches: [branch('auth'), branch('billing', [], 's')] }))
    );


  it('null with no plan artifact', () => {
    expect(new PlanStore(supportWith(null)).scopedRefine('flow-1', 'auth')).toBeNull();
  });

  it('null for an unknown branch name', () => {
    expect(full().scopedRefine('flow-1', 'ghost')).toBeNull();
  });

  it('resolves the branch + its rows from the LATEST plan only', async () => {
    // real plan_steps rows in the isolated DB — liveRows reads the real table
    const { db } = await import('../../../../db');
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ('task_1','generic','TST-1','plan store','open','task','P2')`
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ('flow-1','task_1','plan store','active',?,?)`,
      db.now(), db.now()
    );
    db.run(
      `INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,completed_by,sub_flow_id,created_at,updated_at)
       VALUES ('r1','flow-1',NULL,'s1',0,'A',NULL,'[]','auth','pending','agent',NULL,NULL,?,?)`,
      db.now(), db.now()
    );
    db.run(
      `INSERT INTO plan_steps (id,flow_id,artifact_id,meta_id,position,title,detail,files,branch,status,origin,completed_by,sub_flow_id,created_at,updated_at)
       VALUES ('r2','flow-1',NULL,'s2',1,'B',NULL,'[]','billing','pending','agent',NULL,NULL,?,?)`,
      db.now(), db.now()
    );
    const scoped = full().scopedRefine('flow-1', 'auth');
    expect(scoped?.branch.name).toBe('auth');
    expect(scoped?.liveRows.map(s => s.title)).toEqual(['A']);
  });
});

describe('PlanStore.stepsText / dependencySummaries', () => {
  it('renders live rows compactly — "(none yet)" when empty', () => {
    const store = new PlanStore(supportWith(null));
    expect(store.stepsText([])).toBe('(none yet)');
    expect(store.stepsText([{ id: 'row-1', meta_id: 's1', title: 'A', detail: 'do', files: ['x'] } as never])).toBe(
      '- s1: A — do (1 files)'
    );
  });

  it('renders sibling dependency summaries (or an empty string with none)', () => {
    const latest = {
      art: { id: 'a', version: 1, content: '' },
      meta: { steps: [], branches: [branch('auth', [], 'logins'), branch('billing', ['auth'], 'invoices')] },
      rawMeta: {},
    };
    const store = new PlanStore(supportWith(null));
    expect(store.dependencySummaries(latest, branch('billing', ['auth']))).toBe('- `auth` (auth): logins');
    expect(store.dependencySummaries(latest, branch('auth'))).toBe('');
  });
});

describe('PlanStore.normalizePlannerExecution — lenient planner decision', () => {
  const store = new PlanStore(supportWith(null));

  it('missing/unknown execution normalizes to whole, never a failure', () => {
    expect(store.normalizePlannerExecution(null)).toEqual({ value: 'whole', rationale: null });
    expect(store.normalizePlannerExecution({})).toEqual({ value: 'whole', rationale: null });
    expect(store.normalizePlannerExecution({ execution: 'weird', execution_rationale: 'why' })).toEqual({
      value: 'whole',
      rationale: 'why',
    });
  });

  it('steps + rationale keep a trimmed rationale', () => {
    expect(store.normalizePlannerExecution({ execution: 'steps', execution_rationale: '  why  ' })).toEqual({
      value: 'steps',
      rationale: 'why',
    });
    expect(store.normalizePlannerExecution({ execution: 'steps' })).toEqual({ value: 'steps', rationale: null });
  });
});

describe('PlanStore.persistPlan — published execution rides every version', () => {
  const meta = (overrides: Record<string, unknown> = {}): PlanMeta => ({
    steps: [],
    branches: [branch('auth')],
    ...overrides,
  });
  const persist = (store: PlanStoreT, knob: 'whole' | 'follow', plannerExecution?: unknown) => {
    savedMetas = [];
    return store.persistPlan({
      ctx,
      node,
      userMessage: 'fb',
      text: '# plan',
      planMeta: meta(),
      ...(plannerExecution !== undefined ? { plannerExecution: plannerExecution as never } : {}),
      knob,
    });
  };

  it('knob whole publishes source "knob"', () => {
    persist(new PlanStore(supportWith(null)), 'whole');
    expect(metaOf(0)).toMatchObject({ feedback: 'fb', execution: 'whole', executionSource: 'knob' });
    expect(metaOf(0)).not.toHaveProperty('execution_rationale');
  });

  it('follow publishes the planner decision as source "planner"', () => {
    persist(new PlanStore(supportWith(null)), 'follow', { value: 'steps', rationale: 'independent branches' });
    expect(metaOf(0)).toMatchObject({
      execution: 'steps',
      executionSource: 'planner',
      execution_rationale: 'independent branches',
    });
  });

  it('follow with nothing published publishes whole as source "default"', () => {
    persist(new PlanStore(supportWith(null)), 'follow');
    expect(metaOf(0)).toMatchObject({ execution: 'whole', executionSource: 'default' });
  });
});
