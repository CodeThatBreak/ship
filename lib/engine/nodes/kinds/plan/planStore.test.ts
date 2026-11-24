/**
 * PlanStore — the latest-plan/meta parsing, the current-steps text, and the
 * plan-version publish path.
 *
 * Shared dockerized test database (AGENTS.md §1 — truncated per file); class instances get a stub
 * NodeSupport so the store's calls are observable without touching real rows
 * (the plan_steps sync itself is covered by the runtime's own tests).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assignTestDatabase, resetTestDatabase } from '../../../../../tests/helpers/testDatabase';

assignTestDatabase();

beforeAll(resetTestDatabase);

await import('../../registry');
const { PlanStore } = await import('./planStore');
import type { PlanMeta, PlanStep } from './schema';
import type { FlowCtx, NodeSupport } from '../../shared/nodeSharedExports';
import type { NodeRow } from '../../../../db/rows';

const step = (id: string, title: string, branch: string | null = null): PlanStep => ({
  id,
  title,
  detail: 'd',
  files: ['f.ts'],
  branch,
});

/** A stub support: `latestArtifact` is `row`; every other method is never called. */
const supportWith = (row: { id: string; version: number; content: string; meta: unknown } | null) =>
  ({
    latestArtifact: async () => row,
    saveArtifact: async (nodeId: string, flowId: string, kind: string, content: string, meta?: unknown) => {
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
  // artifact meta is the already-parsed JSONB value under Postgres
  meta: meta == null ? null : meta,
});

const metaOf = (callIndex: number) => (savedMetas ?? [])[callIndex]?.meta as Record<string, unknown> | undefined;

describe('PlanStore.latestPlan — parse + degrade', () => {
  it('returns null without an artifact', async () => {
    expect(await new PlanStore(supportWith(null)).latestPlan('flow-1')).toBeNull();
  });

  it('parses steps from valid meta', async () => {
    const latest = await new PlanStore(supportWith(artRow({ steps: [step('s1', 'A')] }))).latestPlan('flow-1');
    expect(latest).not.toBeNull();
    expect(latest?.meta.steps).toHaveLength(1);
    expect(latest?.art).toEqual({ id: 'art_1', version: 3, content: '# Plan document' });
  });

  it('degrades garbage meta to an empty plan — never throws', async () => {
    const store = new PlanStore(supportWith(artRow('{not json')));
    const latest = await store.latestPlan('flow-1');
    expect(latest).not.toBeNull();
    expect(latest?.meta).toEqual({ steps: [] });
  });

  it('parses steps-only meta (Zod defaults)', async () => {
    const store = new PlanStore(supportWith(artRow({ steps: [step('s1', 'A')] })));
    expect((await store.latestPlan('flow-1'))?.meta).toEqual({ steps: [step('s1', 'A')] });
  });
});

describe('PlanStore.stepsText — compact live rows', () => {
  it('renders live rows compactly — "(none yet)" when empty', () => {
    const store = new PlanStore(supportWith(null));
    expect(store.stepsText([])).toBe('(none yet)');
    expect(store.stepsText([{ id: 'row-1', metaId: 's1', title: 'A', detail: 'do', files: ['x'] } as never])).toBe(
      '- s1: A — do (1 files)'
    );
  });
});

describe('PlanStore.persistPlan — the artifact meta rides every version', () => {
  const meta = (): PlanMeta => ({ steps: [] });

  it('publishes feedback and steps', async () => {
    savedMetas = [];
    await new PlanStore(supportWith(null)).persistPlan({
      ctx,
      node,
      userMessage: 'fb',
      text: '# plan',
      planMeta: meta(),
    });
    expect(metaOf(0)).toEqual({ feedback: 'fb', steps: [] });
  });
});
