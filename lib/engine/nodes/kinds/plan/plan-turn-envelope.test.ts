import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-turn-')), 'test.db');

await import('../../registry');
const { PlanTurnOutput } = await import('./schema');
const { PlanOutputContract } = await import('./plan-contract');
import type { NodeRow } from '../../../../db/rows';
import type { AgentRunner } from '../../../harness';
import type { FlowCtx, NodeSupport } from '../../shared';
import type { PlanStore } from './plan-store';

const goodPlan = {
  markdown: '# Plan',
  steps: [{ title: 'Do thing', detail: '', files: [], branch: null }],
};

const invalidPlan = {
  markdown: '# Plan',
  steps: [],
};

describe('PlanTurnOutput envelope', () => {
  it('accepts reply-only and plan-bearing whole turns', () => {
    expect(PlanTurnOutput.safeParse({ reply: 'ok', plan: goodPlan }).success).toBe(true);
    expect(PlanTurnOutput.safeParse({ reply: 'ok', plan: null }).success).toBe(true);
    expect(PlanTurnOutput.safeParse({ reply: 'ok' }).success).toBe(true);
    expect(PlanTurnOutput.safeParse({ reply: 'ok', plan: invalidPlan }).success).toBe(false);
  });

  it('rejects more than one publish payload', () => {
    expect(
      PlanTurnOutput.safeParse({ reply: 'x', plan: goodPlan, subPlanPatch: { upsertSteps: [goodPlan.steps[0]] } })
        .success
    ).toBe(false);
  });
});

describe('PlanOutputContract.parseTurnEnvelope', () => {
  const contract = new PlanOutputContract(
    {} as NodeSupport,
    {} as PlanStore,
    {} as AgentRunner,
    () => 'whole',
    'Plan'
  );

  it('parses a valid unified turn', () => {
    expect(contract.parseTurnEnvelope(JSON.stringify({ reply: 'hi' })).reply).toBe('hi');
  });
});
