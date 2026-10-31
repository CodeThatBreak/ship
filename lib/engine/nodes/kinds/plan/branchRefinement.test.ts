import { describe, expect, it } from 'vitest';
import { BranchRefinement } from './branchRefinement';
import type { PlanMeta, PlanStep } from './schema';

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

describe('BranchRefinement.applyPatch', () => {
  it('upserts a step by id without touching other branches', () => {
    const meta = metaWithTwoBranches();
    const patched = BranchRefinement.applyPatch(meta, 'billing', {
      upsertSteps: [{ ...step('s4', 'Billing invoice'), detail: 'patched' }],
    });
    const billing = patched.steps.filter(s => s.branch === 'billing');
    expect(billing.find(s => s.id === 's4')?.detail).toBe('patched');
    expect(patched.steps.filter(s => s.branch === 'auth')).toEqual(meta.steps.filter(s => s.branch === 'auth'));
  });

  it('removes steps by id within the branch only', () => {
    const meta = metaWithTwoBranches();
    const patched = BranchRefinement.applyPatch(meta, 'auth', { removeStepIds: ['s3'] });
    expect(patched.steps.some(s => s.branch === 'auth' && s.id === 's3')).toBe(false);
    expect(patched.steps.filter(s => s.branch === 'billing')).toEqual(meta.steps.filter(s => s.branch === 'billing'));
  });

  it('replaces branch markdown only', () => {
    const meta = metaWithTwoBranches();
    const patched = BranchRefinement.applyPatch(meta, 'billing', { markdown: '## billing doc' });
    expect(patched.branches.find(b => b.name === 'billing')?.markdown).toBe('## billing doc');
    expect(patched.steps).toEqual(meta.steps);
  });
});
