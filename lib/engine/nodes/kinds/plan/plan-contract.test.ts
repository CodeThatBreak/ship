/**
 * PlanOutputContract — the parse half of the contract (the three standard
 * failures: no_json / agent_reported / schema_mismatch with the issue payload)
 * plus the whole-outcome shape. The scoped merge/replace path is covered by
 * BranchRefinement's tests; the whole outcome here uses a stub store.
 * Isolated temp SQLite DB per AGENTS.md §1.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-contract-')), 'test.db');

await import('../../registry');
const { PlanOutputContract } = await import('./plan-contract');
const { PlanResponse } = await import('./schema');
const { AGENT_OUTPUT_ERROR, AgentOutputError } = await import('../../shared/agent/output-error');
import type { AgentOutputError as AgentOutputErrorT } from '../../shared/agent/output-error';
import type { NodeRow } from '../../../../db/rows';
import type { AgentRunner } from '../../../harness';
import type { FlowCtx, NodeSupport } from '../../shared';
import type { PlanStore } from './plan-store';

/** The agent's error envelope, as the directive advertises it. */
const envelope = (reason: string) => JSON.stringify({ output_error: { code: 'blocked', reason } });

const makeContract = () => {
  const saved: {
    kind?: string;
    content?: string;
    meta?: unknown;
    text?: string;
    planMeta?: unknown;
    plannerExecution?: unknown;
    knob?: string;
  }[] = [];
  const support = {
    saveArtifact: (_nodeId: string, _flowId: string, kind: string, content: string, meta?: unknown) => {
      saved.push({ kind, meta, content });
      return { id: 'art_new', version: 7 };
    },
  } as unknown as NodeSupport;
  const store = {
    normalizePlannerExecution: (w: unknown) =>
      (w as { execution?: string })?.execution === 'steps'
        ? { value: 'steps', rationale: null }
        : { value: 'whole', rationale: null },
    persistPlan: (args: { text: string; planMeta: unknown; plannerExecution: unknown; knob: string }) => {
      saved.push({ text: args.text, planMeta: args.planMeta, plannerExecution: args.plannerExecution, knob: args.knob });
      return { art: { id: 'art_new', version: 7 }, stepCount: 2 };
    },
  } as unknown as PlanStore;
  const runner = {
    executeRun: () => {
      throw new Error('retry should not start an agent in this test');
    },
    startAgent: () => {
      throw new Error('retry should not start an agent in this test');
    },
  } as unknown as AgentRunner;
  const contract = new PlanOutputContract(support, store, runner, () => 'whole', 'Plan');
  return { contract, saved };
};

const ctx = { flow: { id: 'flow-1' } } as unknown as FlowCtx;
const node = { id: 'node-1' } as unknown as NodeRow;

describe('PlanOutputContract.parse — the three standard failures', () => {
  const parse = (text: string) => makeContract().contract.parse(text, PlanResponse);

  it('no JSON at all → no_json, with the response excerpt in the payload', () => {
    let err: AgentOutputErrorT | null = null;
    try {
      parse('not json');
    } catch (e) {
      err = e as AgentOutputErrorT;
    }
    expect(err).not.toBeNull();
    expect(err?.code).toBe(AGENT_OUTPUT_ERROR.NO_JSON);
    expect(err?.message).toContain('no JSON');
  });

  it('the agent error envelope → agent_reported; the agent reason is the headline', () => {
    expect(() => parse(envelope('the ticket is missing acceptance criteria'))).toThrow(AgentOutputError);
    try {
      parse(envelope('the ticket is missing acceptance criteria'));
      throw new Error('expected a throw');
    } catch (e) {
      const err = e as AgentOutputErrorT;
      expect(err.code).toBe(AGENT_OUTPUT_ERROR.AGENT_REPORTED);
      expect(err.message).toContain('the ticket is missing acceptance criteria');
    }
  });

  it('schema violation → schema_mismatch; the first issue leads and all ride the payload', () => {
    try {
      parse(JSON.stringify({ markdown: '# P', steps: [] }));
      throw new Error('expected a throw');
    } catch (e) {
      const err = e as AgentOutputErrorT;
      expect(err.code).toBe(AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH);
      expect(err.message).toBe(err.detail.issues[0]?.message);
      expect(err.detail.issues.length).toBeGreaterThan(0);
    }
  });

  it('a valid plan parses through the whole contract', () => {
    expect(parse(JSON.stringify({ markdown: '# P', steps: [{ title: 'T', detail: '', files: [], branch: null }] }))).toEqual({
      markdown: '# P',
      steps: [{ title: 'T', detail: '', files: [], branch: null }],
    });
  });
});

describe('PlanOutputContract.apply (whole) — the run outcome', () => {
  it('awaits approval with the fresh artifact version; persist + sync happen in the store', () => {
    const { contract, saved } = makeContract();
    const outcome = contract.apply(
      ctx,
      node,
      { feedback: 'fb' } as Parameters<typeof contract.apply>[2],
      JSON.stringify({
        markdown: '# P',
        steps: [{ id: 's1', title: 'T', detail: '', files: [], branch: null }],
        execution: 'steps',
        execution_rationale: 'independent',
      }),
      null
    );
    expect(outcome.status).toBe('awaiting_approval');
    expect(outcome.output).toMatchObject({ latestArtifact: 'art_new', version: 7 });
    expect(outcome.event).toBe('plan v7 ready for review · 2 steps');
    expect(saved[0]?.text).toBe('# P');
    const persisted = saved[0] as { planMeta: { steps: { id: string }[] }; plannerExecution: { value: string } };
    expect(persisted.planMeta.steps[0].id).toBe('s1'); // withStepIds ran before persist
    expect(persisted.plannerExecution.value).toBe('steps');
  });
});

describe('PlanOutputContract.recoverOutcome — its gate on parse failures', () => {
  it('an unparseable recorded result is NOT recoverable', () => {
    const { contract } = makeContract();
    expect(contract.recoverOutcome(ctx, node, { status: 'error', result: 'garbage' } as never)).toBeNull();
  });
});
