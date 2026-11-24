/**
 * PlanPromptBuilder — the conversation prompt, the follow-up prompt and the
 * verbatim-prompt shortcut of the whole prompt. All collaborators are stubs —
 * no DB dependency beyond module import (isolated temp DB, §1).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-prompt-')), 'test.db');

await import('../../registry');
const { PlanPromptBuilder } = await import('./planPrompt');
const { planBodyDiverged } = await import('./utils/planBodyDiverged');
const { DEFAULT_PROMPT_TEMPLATES } = await import('../../../prompts/promptDefaults');
const { AgentOutputError } = await import('../../shared/agent/outputError/outputErrorExports');
const { PLAN_TURN_OUTPUT_JSON_SCHEMA } = await import('./schema');
import type { PlanInput } from './schema';
import type { NodeRow } from '../../../../db/rows';
import type { FlowCtx, FlowContextHelper } from '../../shared/nodeSharedExports';
import type { PlanContextBlocks } from './planContext';

const nodeWith = (agentId: string | null) => ({ agentId }) as unknown as NodeRow;

const makeBuilder = () => {
  const ctxHelper = {
    taskContext: () => 'TASK',
    taskLabel: () => 'Label',
    execMode: () => 'cloud',
  } as unknown as FlowContextHelper;
  const context = { assemble: async () => 'CTX' } as unknown as PlanContextBlocks;
  return new PlanPromptBuilder(ctxHelper, context);
};

const ctx = { flow: { id: 'flow-1' }, task: { key: 'T-1' } } as unknown as FlowCtx;

describe('PlanPromptBuilder.whole — the verbatim-prompt shortcut', () => {
  it('a raw verbatim prompt rides through untouched (no contract re-append)', async () => {
    const out = await makeBuilder().whole(ctx, nodeWith(null), {
      prompt: 'EXACT TEXT',
      promptIsBody: false,
    } as PlanInput);
    expect(out).toBe('EXACT TEXT');
  });
});

describe('PlanPromptBuilder.refineTurn — the conversation contract template (§2)', () => {
  it('the developer message interpolates into the plan_refine conversation contract with the context block', async () => {
    const out = await makeBuilder().refineTurn(ctx, 'why is step 2 blocked?');
    expect(out).toContain('why is step 2 blocked?');
    // the template body assembles ({{feedback}}/{{context}} resolved) in the
    // conversation shape: reply + optional plan, with the hand-edit rule
    expect(out).toContain('The conversation continues');
    expect(out).toContain('omit "plan" for questions, critiques, status requests');
    // the whole-mode context assembly feeds {{context}} (the `edits` default-on
    // block that preserves hand edits)
    expect(out).toContain('CTX');
    expect(out.startsWith('The conversation continues')).toBe(true);
  });

  it('the plan_refine template carries the generated PlanTurnOutput directive in the locked contract block', () => {
    const tpl = DEFAULT_PROMPT_TEMPLATES.plan_refine;
    expect(tpl.variables).toEqual(['feedback', 'context']);
    expect(tpl.internalBlocks).toHaveLength(1);
    expect(tpl.internalBlocks[0]?.kind).toBe('contract');
    // step 05: the contract block IS the schema-generated directive — the
    // same bytes the plan retry prompt appends (see generatedDirectives.test)
    expect(tpl.internalBlocks[0]?.text).toBe(AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA));
    expect(tpl.userTemplate).toContain('The conversation continues');
    // the base `plan` template body is untouched by this phase
    expect(DEFAULT_PROMPT_TEMPLATES.plan.userTemplate.startsWith('You are planning the implementation of a {{ticket_type}}')).toBe(true);
  });
});

describe('planBodyDiverged — the §8/§6c "start" divergence check', () => {
  it('an identical (or blank-run-normalized) body is NOT a divergence — first/template runs record nothing', () => {
    expect(planBodyDiverged(DEFAULT_PROMPT_TEMPLATES.plan.userTemplate)).toBe(false);
    // blank-line runs collapse the same way the assembly normalizes them
    expect(planBodyDiverged(DEFAULT_PROMPT_TEMPLATES.plan.userTemplate.replace('\n\n', '\n\n\n\n'))).toBe(false);
  });

  it('a clearly edited body diverges', () => {
    expect(planBodyDiverged(`${DEFAULT_PROMPT_TEMPLATES.plan.userTemplate}\nExtra step: check the migrations.`)).toBe(true);
  });

  it('null/blank bodies never count as a divergence (default when in doubt: NO provenance)', () => {
    expect(planBodyDiverged(null)).toBe(false);
    expect(planBodyDiverged('')).toBe(false);
    expect(planBodyDiverged('   ')).toBe(false);
  });
});
