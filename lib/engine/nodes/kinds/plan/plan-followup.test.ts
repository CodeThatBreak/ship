/**
 * The §1 parse matrix (docs/plan-conversation-refine.md) — the follow-up
 * contract's turn kinds. Pure module: no DB dependency, the isolated temp DB
 * is set first per the engine-test harness convention anyway.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-followup-')), 'test.db');

await import('../../registry');
const { parseFollowUp } = await import('./plan-followup');
const { PlanFollowUp } = await import('./schema');

const step = (id: string, title: string) => ({ id, title, detail: 'd', files: ['f.ts'], branch: null });
const goodPlan = { markdown: '# Plan', steps: [step('s1', 'First'), step('s2', 'Second')] };
const invalidPlan = { markdown: '# Plan', steps: [step('s1', 'First'), step('s1', 'Again')] };

describe('parseFollowUp — the turn kinds (§1)', () => {
  it('a full envelope: the reply AND the plan payload ride through (plan validated at the apply)', () => {
    expect(parseFollowUp(JSON.stringify({ reply: 'Moved step 2.', plan: goodPlan }))).toEqual({
      reply: 'Moved step 2.',
      plan: goodPlan,
    });
  });

  it('an explicit "plan": null is a reply-only turn — the same as an omitted "plan"', () => {
    expect(parseFollowUp(JSON.stringify({ reply: 'Answered.', plan: null }))).toEqual({
      reply: 'Answered.',
      plan: null,
    });
    expect(parseFollowUp(JSON.stringify({ reply: 'Answered.' }))).toEqual({ reply: 'Answered.', plan: null });
  });

  it('a bare plan (the envelope was dropped): plan-only turn, reply defaults to "Plan updated."', () => {
    expect(parseFollowUp(JSON.stringify(goodPlan))).toEqual({ reply: 'Plan updated.', plan: goodPlan });
  });

  it('an envelope missing "reply" with a plan: plan wins — reply defaults', () => {
    expect(parseFollowUp(JSON.stringify({ plan: goodPlan }))).toEqual({
      reply: 'Plan updated.',
      plan: goodPlan,
    });
  });

  it('free-form (non-JSON) output is NEVER a plan — the raw text becomes the reply', () => {
    const raw = 'Sure — here is where things stand: step 2 is blocked on the migration.';
    expect(parseFollowUp(raw)).toEqual({ reply: raw, plan: null });
  });

  it('garbage JSON that is not a contract object degrades to the raw text as the reply', () => {
    const raw = '```json\n{"lorem": "ipsum"}\n```';
    expect(parseFollowUp(raw)).toEqual({ reply: raw, plan: null });
  });

  it('an empty/undefined run result stays a reply-only turn (handle gracefully)', () => {
    expect(parseFollowUp('')).toEqual({ reply: '', plan: null });
    expect(parseFollowUp(undefined)).toEqual({ reply: '', plan: null });
  });

  it('the agent error envelope: its own reason becomes the reply (never a plan)', () => {
    const raw = JSON.stringify({ output_error: { code: 'blocked', reason: 'the ticket is missing the scope' } });
    expect(parseFollowUp(raw)).toEqual({ reply: 'the ticket is missing the scope', plan: null });
  });

  it('an envelope whose plan carries a refinement violation is STILL plan-bearing — never a silent reply-only', () => {
    // the §1 strictness guarantee: an invalid plan payload must reach the
    // §3c bounded-retry path (applyPlanVersion), not degrade to a reply
    const parsed = parseFollowUp(JSON.stringify({ reply: 'Done.', plan: invalidPlan }));
    expect(parsed.plan).toEqual(invalidPlan);
  });

  it('a bare INVALID plan attempt is also plan-bearing — the apply catches the violation', () => {
    const parsed = parseFollowUp(JSON.stringify(invalidPlan));
    expect(parsed.plan).toEqual(invalidPlan);
    expect(parsed.reply).toBe('Plan updated.');
  });

  it('the whole-envelope PlanFollowUp shape validates a clean turn (the contract exists for the retry directive)', () => {
    expect(PlanFollowUp.safeParse({ reply: 'ok', plan: goodPlan }).success).toBe(true);
    expect(PlanFollowUp.safeParse({ reply: 'ok', plan: null }).success).toBe(true);
    // the refinement rides the embedded PlanResponse
    expect(PlanFollowUp.safeParse({ reply: 'ok', plan: invalidPlan }).success).toBe(false);
  });

  it('non-object JSON payloads stay reply-only', () => {
    expect(parseFollowUp('[1,2,3]')).toEqual({ reply: '[1,2,3]', plan: null });
    expect(parseFollowUp('"a quoted string"')).toEqual({ reply: '"a quoted string"', plan: null });
  });
});

describe('parseFollowUp — it keeps the machine quiet for the honest cases', () => {
  it('debug-logs only on the degraded fallbacks (envelope + bare-plan turns stay silent)', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      parseFollowUp(JSON.stringify({ reply: 'ok' }));
      expect(debug).not.toHaveBeenCalled();
      parseFollowUp(JSON.stringify(goodPlan));
      expect(debug).toHaveBeenCalledTimes(1);
      parseFollowUp('just prose');
      expect(debug).toHaveBeenCalledTimes(2);
    } finally {
      debug.mockRestore();
    }
  });
});
