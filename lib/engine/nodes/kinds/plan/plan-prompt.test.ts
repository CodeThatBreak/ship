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
const { PlanPromptBuilder } = await import('./plan-prompt');
import type { PlanBranch, PlanStep, PlanInput } from './schema';
import type { NodeRow } from '../../../../db/rows';
import type { FlowCtx, FlowContextHelper } from '../../shared';
import type { PlanContextBlocks } from './plan-context';
import type { PlanStore } from './plan-store';
import type { ScopedRefine } from './types';

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

describe('PlanPromptBuilder.runIntent — label + follow-up resolution', () => {
  const intent = (input: Partial<PlanInput>, agentId = 'agent-1', scopedInput: ScopedRefine | null = null) =>
    makeBuilder('whole').runIntent(nodeWith(agentId), input as PlanInput, scopedInput);

  it('a plain first plan: label "plan", fresh (no follow-up)', () => {
    expect(intent({})).toEqual({ label: 'plan', followUpOn: null });
  });

  it('whole-plan refine with an agent: follow-up by default, "plan refine"', () => {
    expect(intent({ feedback: 'tighten' })).toEqual({ label: 'plan refine', followUpOn: 'agent-1' });
  });

  it('`fresh: true` beats a follow-up even when an agent exists', () => {
    expect(intent({ feedback: 'tighten', fresh: true })).toEqual({ label: 'plan refine', followUpOn: null });
  });

  it('scoped refines are fresh by default and label with the branch name', () => {
    expect(intent({ branchRef: 'auth' }, 'agent-1', scoped())).toEqual({
      label: 'sub-plan refine (auth, fresh)',
      followUpOn: null,
    });
  });

  it('scoped refine with fresh: false follows up on the node agent', () => {
    expect(intent({ branchRef: 'auth', fresh: false }, 'agent-1', scoped())).toEqual({
      label: 'sub-plan refine (auth)',
      followUpOn: 'agent-1',
    });
  });
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
    const vars = makeBuilder('whole').scopedVars(ctx, scoped(), { feedback: '', contextBlocks: [] });
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
    const vars = makeBuilder('whole').scopedVars(ctx, bare, { feedback: 'go', contextBlocks: [] });
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
