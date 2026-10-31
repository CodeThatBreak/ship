/**
 * PlanPromptBuilder — the run intent (label + follow-up), the execution
 * directive (knob-gated, byte-stable otherwise), the scoped template vars, and
 * the verbatim-prompt shortcut of the whole prompt. All collaborators are
 * stubs — no DB dependency beyond module import (isolated temp DB, §1).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-prompt-')), 'test.db');

await import('../../registry');
const { PlanPromptBuilder } = await import('./planPrompt');
const { planBodyDiverged } = await import('./planPrompt');
const { DEFAULT_PROMPT_TEMPLATES } = await import('../../../prompts/promptDefaults');
import type { PlanBranch, PlanStep, PlanInput } from './schema';
import type { NodeRow } from '../../../../db/rows';
import type { FlowCtx, FlowContextHelper } from '../../shared/nodeSharedExports';
import type { PlanContextBlocks } from './planContext';
import type { PlanStore } from './planStore';
import type { ScopedRefine } from './types/planTypeExports';

const nodeWith = (agentId: string | null) => ({ agent_id: agentId }) as unknown as NodeRow;

const makeBuilder = (knob: 'whole' | 'follow') => {
  const ctxHelper = {
    taskContext: () => 'TASK',
    taskLabel: () => 'Label',
    execMode: () => 'cloud',
  } as unknown as FlowContextHelper;
  const context = { assemble: () => 'CTX' } as unknown as PlanContextBlocks;
  const store = {
    stepsText: (rows: { title: string }[]) => rows.map(r => r.title).join('\n'),
    dependencySummaries: (_latest: unknown, b: { dependsOn: string[] }) =>
      b.dependsOn.includes('b2') ? '- `b2` (B2): s2b' : '',
  } as unknown as PlanStore;
  return new PlanPromptBuilder(ctxHelper, context, store, () => knob);
};

const ctx = { flow: { id: 'flow-1' }, task: { key: 'T-1' } } as unknown as FlowCtx;

const branchStep: PlanStep = { id: 's1', title: 'Live', detail: '', files: [], branch: 'auth' };
const authBranch: PlanBranch = {
  name: 'auth',
  title: 'Auth',
  scope: 'logins',
  files: ['a.ts'],
  steps: [],
  dependsOn: ['b2'],
};
const scoped = (): ScopedRefine => ({
  latest: { art: { id: 'a', version: 2, content: '' }, meta: { steps: [], branches: [authBranch] }, rawMeta: {} },
  branch: authBranch,
  liveRows: [branchStep as never],
});

describe('PlanPromptBuilder.executionDirective — the follow-only prompt delta', () => {
  it('follow renders the branch child-flow contract fields', () => {
    const directive = makeBuilder('follow').executionDirective(ctx);
    if (!directive) throw new Error('expected a directive under follow');
    expect(directive).toContain('"execution": "whole" or "steps"');
    expect(directive).toContain('"execution_rationale"');
    expect(directive).toContain('each declared BRANCH becomes its own monitorable child flow');
    expect(directive).toContain('declare "dependsOn"');
    expect(directive).toContain('one at a time');
  });

  it('any other knob → null (non-follow prompts stay byte-identical)', () => {
    expect(makeBuilder('whole').executionDirective(ctx)).toBeNull();
  });
});

describe('PlanPromptBuilder.scopedVars — built from the ref branch only', () => {
  it('fills branch, scope, files, dependencies, sub-plan seed and live steps', () => {
    const vars = makeBuilder('whole').scopedVars(ctx, scoped(), '', []);
    expect(vars.branch).toBe('auth');
    expect(vars.scope).toBe('logins');
    expect(vars.files).toBe('a.ts');
    expect(vars.dependsOn).toBe('b2');
    expect(vars.dependsOnSummaries).toBe('- `b2` (B2): s2b');
    expect(vars.subPlanPrompt).toBe('(none yet — seed the sub-plan from the contract above)');
    expect(vars.currentSteps).toBe('Live');
    expect(vars.feedback).toBe('');
  });

  it('missing values state themselves instead of going blank', () => {
    const bare: ScopedRefine = {
      ...scoped(),
      branch: { ...authBranch, scope: '', files: [], dependsOn: [] },
    };
    const vars = makeBuilder('whole').scopedVars(ctx, bare, 'go', []);
    expect(vars.scope).toBe('(none stated)');
    expect(vars.files).toBe('(none stated)');
    expect(vars.dependsOn).toBe('(none)');
    expect(vars.dependsOnSummaries).toBe('');
    expect(vars.feedback).toBe('go');
  });
});

describe('PlanPromptBuilder.whole — the verbatim-prompt shortcut', () => {
  it('a raw verbatim prompt rides through untouched (no contract re-append)', () => {
    const out = makeBuilder('follow').whole(ctx, nodeWith(null), {
      prompt: 'EXACT TEXT',
      promptIsBody: false,
    } as PlanInput, '');
    expect(out).toBe('EXACT TEXT');
  });
});

describe('PlanPromptBuilder.refineTurn — the conversation contract template (§2)', () => {
  it('the developer message interpolates into the plan_refine conversation contract with the context block and user rules', () => {
    const out = makeBuilder('whole').refineTurn(ctx, 'why is step 2 blocked?', 'RULES');
    expect(out).toContain('why is step 2 blocked?');
    // the template body assembles ({{feedback}}/{{context}} resolved) in the
    // conversation shape: reply + optional plan, with the hand-edit rule
    expect(out).toContain('The conversation continues');
    expect(out).toContain('omit "plan" for questions, critiques, status requests');
    // the whole-mode context assembly feeds {{context}} (the `edits` default-on
    // block that preserves hand edits)
    expect(out).toContain('CTX');
    // the user's standing rules land right after the body
    expect(out).toContain('RULES');
    expect(out.startsWith('The conversation continues')).toBe(true);
  });

  it('the follow-mode execution directive is appended (mirroring whole()), skipped under whole', () => {
    expect(makeBuilder('whole').refineTurn(ctx, 'msg', '')).not.toContain('Execution resolution');
    expect(makeBuilder('follow').refineTurn(ctx, 'msg', '')).toContain('"execution": "whole" or "steps"');
  });

  it('the plan_refine template carries PlanTurnOutput in the locked contract block', () => {
    const tpl = DEFAULT_PROMPT_TEMPLATES.plan_refine;
    expect(tpl.variables).toEqual(['feedback', 'context']);
    expect(tpl.internalBlocks).toHaveLength(1);
    expect(tpl.internalBlocks[0]?.kind).toBe('contract');
    expect(tpl.internalBlocks[0]?.text).toContain('PlanTurnOutput');
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
