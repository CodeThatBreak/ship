/**
 * Plan-node domain pieces on the agent-node infrastructure: the ONE response
 * schema (plan-domain rules as refinements — the retry feedback text depends
 * on their messages), the chat turn paths, and the generated output-contract
 * schemas.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database). The imports hoist it —
 * dynamic imports keep the order.
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from 'vitest';


// the registry instantiates every builtin on first load — resolve its import
// cycle from here (not from a mid-evaluation node class) so all classes are
// fully initialized before plan-node is imported
await import('../../registry');
const {
  PLAN_RESPONSE_JSON_SCHEMA,
  PlanResponse,
  withStepIds,
  PlanInput,
} = await import('./schema');
const { PlanNode } = await import('./planNode');
const { resolvePlanFailedRetryStatus, resolvePlanTurnPreviousStatus } = await import('./planRetryRevert');
const { NODE_STATUS } = await import('../../../constants/nodeStatus');
import { assignTestDatabase, resetTestDatabase } from '../../../../../tests/helpers/testDatabase';

assignTestDatabase();

const { db } = await import('../../../../db/app');

beforeAll(resetTestDatabase);
import type { PlanStep } from './schema';
import type { FlowCtx, FlowContextHelper } from '../../shared/nodeSharedExports';
import type { NodeSupport } from '../../shared/nodeSupport';
import type { AgentRunner } from '../../../harness/harnessExports';
import type { NodeRow } from '../../../../db/rows';

/** Messages of a schema's violations for one payload. */
const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map(i => i.message);

const step = (id: string, title: string, branch: string | null = null): PlanStep => ({
  id,
  title,
  detail: 'd',
  files: ['f.ts'],
  branch,
});

describe('PlanResponse — the one plan schema (plan rules as refinements)', () => {
  const valid = {
    markdown: '# Plan',
    steps: [step('s1', 'First'), step('s2', 'Second')],
  };

  it('accepts a valid plan', () => {
    expect(PlanResponse.safeParse(valid).success).toBe(true);
  });

  it('rejects duplicate step ids — the retry feedback message', () => {
    const msgs = messagesOf(
      PlanResponse.safeParse({
        ...valid,
        steps: [step('s1', 'First'), step('s1', 'Again')],
      })
    );
    expect(msgs).toContain('duplicate step id "s1"');
  });

  it('withStepIds fills missing ids in order (s1, s2, …)', () => {
    const filled = withStepIds([
      { title: 'First', detail: '', files: [], branch: null },
      { title: 'Second', detail: '', files: [], branch: null },
    ]);
    expect(filled.map(s => s.id)).toEqual(['s1', 's2']);
  });
});

describe('the generated output-contract schema', () => {
  it('renders the plan response as a JSON Schema object', () => {
    expect(PLAN_RESPONSE_JSON_SCHEMA).toBeTypeOf('object');
    expect(JSON.stringify(PLAN_RESPONSE_JSON_SCHEMA)).toContain('"markdown"');
  });
});

describe('PlanNode — chat via the follow-up contract (docs/plan-conversation-refine.md §3a–c)', () => {
  // real rows for `plan_steps` FKs (the checklist sync writes live rows in the
  // shared test DB — see chatNode's saveArtifact); `db` resolves above with the
  // other dynamic imports
  beforeAll(async () => {
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority)
       VALUES ('task_chat','generic','T-1','plan chat contract test','open','task','P2') ON CONFLICT DO NOTHING`
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at)
       VALUES ('flow-1','task_chat','plan chat contract test','active',$1,$2) ON CONFLICT DO NOTHING`,
      db.now(), db.now()
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, agent_id, created_at, updated_at)
       VALUES ('node-1','flow-1','plan','plan','awaiting_approval',NULL,$1,$2) ON CONFLICT DO NOTHING`,
      db.now(), db.now()
    );
  });

  const ctx = {
    flow: { id: 'flow-1' },
    task: { key: 'T-1' },
  } as unknown as FlowCtx;

  /** File-scope artifact id counter — each chatNode save needs a unique row id. */
  let chatArtifactSeq = 0;

  /* the LATEST plan artifact row the store sees — version 2, meta parsed like
   * artifact rows really are */
  const prevPlanRow = {
    id: 'art_1',
    version: 2,
    content: '# Plan document',
    meta: { steps: [step('s1', 'First')] },
  };

  /** The stub harness: support journals artifact saves + node updates + events;
   *  the runner answers ONE turn per `executeRun` call from the response queue
   *  (and records both `startAgent` inputs and the run labels). */
  const chatNode = (opts: {
    responses: string[]; // one per expected agent turn
    status?: string;
    /** When set, the live row mirrors sendChat's claim: `running` + attempt token. */
    claimed?: string | null;
    agentId?: string | null;
    /** the latest plan artifact the store sees (defaults to a version-2 plan) */
    prevRow?: { id: string; version: number; content: string; meta: unknown } | null;
  }) => {
    const observ = {
      startAgentInputs: [] as unknown as { prompt: string; mode: string; followUpOn: string | null; model: string | null }[],
      labels: [] as string[],
      savedMetas: [] as (Record<string, unknown> | null)[],
      savedContents: [] as string[],
      savedArts: [] as { id: string; version: number }[],
      nodePatches: [] as Record<string, unknown>[],
      events: [] as string[],
    };
    const support = {
      // the live row: when `claimed` is set it reflects the sendChat claim
      // the engine performs before dispatching the turn (running + attempt)
      nodeByKey: async (flowId: string, key: string) =>
        ({
          id: 'node-1',
          flowId,
          nodeKey: key,
          status: opts.claimed != null ? 'running' : opts.status ?? 'awaiting_approval',
          attemptId: opts.claimed ?? null,
          agentId: null,
          config: '{}',
        }) as unknown as NodeRow,
      lastAgentId: async () => opts.agentId ?? null,
      setNode: async (_id: string, patch: Record<string, unknown>) => {
        observ.nodePatches.push(patch);
      },
      // the live row is honest in this harness: a fenced patch always applies
      // (the step-02 authority delegates journal in the same patch shape)
      applyTransitionFenced: async (p: { toStatus?: string; patch?: Record<string, unknown> }) => {
        observ.nodePatches.push({ status: p.toStatus, ...(p.patch ?? {}) });
      },
      applyTransition: async (_f: string, _k: string, _key: string, o?: { toStatus?: string; patch?: Record<string, unknown> }) => {
        observ.nodePatches.push({ status: o?.toStatus, ...(o?.patch ?? {}) });
        return true;
      },
      publishOutcome: async (p: { outcome: { status: string; output: Record<string, unknown>; agentId?: string | null } }) => {
        observ.nodePatches.push({ status: p.outcome.status, output: p.outcome.output, agent_id: p.outcome.agentId ?? null });
      },
      // REAL artifact persist (the isolated DB has task/flow/node rows seeded
      // below) so `persistPlan`'s checklist sync can write valid `plan_steps`
      // rows — with the meta/observability journal on top.
      async saveArtifact(nodeId: string, flowId: string, kind: string, content: string, meta?: unknown) {
        observ.savedMetas.push((meta ?? null) as Record<string, unknown> | null);
        observ.savedContents.push(content);
        const prev = await testGet<{ v: number | null }>(`SELECT MAX(version) AS v FROM artifacts WHERE node_id=$1 AND kind=$2`, nodeId, kind);
        const version = (prev?.v ?? 0) + 1;
        const id = `art_chat_${String(++chatArtifactSeq)}`;
        await testRun(
          `INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'draft',$8)`,
          id, nodeId, flowId, kind, version, content, meta ? JSON.stringify(meta) : null, db.now()
        );
        const art = { id, version };
        observ.savedArts.push(art);
        return art;
      },
      latestArtifact: async () => (opts.prevRow === undefined ? prevPlanRow : opts.prevRow),
      artifactsOfKind: async () => (opts.prevRow === undefined ? [{ id: 'art_1', version: 2, content: '# Plan document', meta: prevPlanRow.meta }] : []),
      emitLifecycle: async (_flowId: string, _nodeId: string, message: string) => {
        observ.events.push(message);
      },
      // typed pipeline events (step 05: output_retry / output_exhausted / agent_reported)
      emit: async (_flowId: string, _nodeId: string, _kind: string, message: string) => {
        observ.events.push(message);
      },
      // the completion batch (step 06) runs its writes through the support
      // transaction — the stub executes the batch inline against the real DB
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    } as unknown as NodeSupport;
    const runner = {
      startAgent: (_ctx: FlowCtx, input: unknown) => {
        observ.startAgentInputs.push(input as never);
        return Promise.resolve({ agentId: 'agent_1', runId: 'run_1' });
      },
      executeRun: (_ctx: FlowCtx, _nodeId: string, start: () => Promise<unknown>, label: string) => {
        observ.labels.push(label);
        return start().then(() => ({
          result: {
            status: 'finished',
            result: responses.shift(),
            sessionId: 'session_1',
            durationMs: 1,
            usage: null,
          },
          runRowId: 'run_row_test',
        }));
      },
    } as unknown as AgentRunner;
      const responses = [...opts.responses];
    const node = new PlanNode(
      support as unknown as NodeSupport,
      runner as unknown as AgentRunner,
      {
        taskContext: () => 'TASK-1 context',
        taskLabel: () => 'task',
        execMode: () => 'cloud',
      } as unknown as FlowContextHelper
    );
    return { node, observ };
  };

  const validPlanPayload = {
    markdown: '# Plan (refined)',
    steps: [step('s1', 'First'), step('s2', 'Second')],
  };

  it('reply-only turn: the reply comes back; NO artifact, no status change, no checklist event, no version', async () => {
    const { node, observ } = chatNode({ responses: [JSON.stringify({ reply: 'Answered: step 2 is blocked.' })] });
    const reply = await node.chat(ctx, 'why is step 2 blocked?');
    expect(reply).toBe('Answered: step 2 is blocked.');
    expect(observ.savedMetas).toHaveLength(0);
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
    expect(observ.events).toHaveLength(0);
    expect(observ.startAgentInputs).toHaveLength(1);
    // the same-session follow-up turn, labelled as the conversation kind it is
    const turn = observ.startAgentInputs[0];
    expect(turn.mode).toBe('plan');
    expect(turn.followUpOn).toBeNull();
    expect(observ.labels).toEqual(['plan chat']);
  });

  it('plan-bearing turn: the reply flows AND the version lands through the refine path', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Moved step 2 below step 1.', plan: validPlanPayload })],
    });
    const reply = await node.chat(ctx, 'move step 2 below step 1');
    expect(reply).toBe('Moved step 2 below step 1.');
    // one new plan artifact version, with the conversation meta
    expect(observ.savedContents).toEqual(['# Plan (refined)']);
    const meta = observ.savedMetas[0] as Record<string, unknown>;
    expect(meta.feedback).toBe('move step 2 below step 1');
    expect(meta.refinedFrom).toEqual({ version: 2, source: 'chat' });
    // the node row landed exactly like a normal refine's outcome
    const art = observ.savedArts[0];
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
    expect(observ.nodePatches.find(p => p.output != null)?.output).toMatchObject({ latestArtifact: art.id });
    expect(observ.events).toContain(`plan v${art.version} ready for review · 2 steps`);
    // the checklist synced from the plan payload (Id runs through the store's
    // real syncFromPlan into the live rows)
    const checklist = await testAll<{ title: string }>(`SELECT title FROM plan_steps WHERE flow_id=$1 ORDER BY position`, 'flow-1');
    expect(checklist.map(r => r.title)).toEqual(['First', 'Second']);
  });

  it('an invalid plan: exactly ONE feedback retry turn, then a plain refusal — the node never becomes failed', async () => {
    const invalid = { ...validPlanPayload, steps: [step('s1', 'First'), step('s1', 'Again')] };
    const { node, observ } = chatNode({
      responses: [
        JSON.stringify({ reply: 'Fixed.', plan: invalid }),
        JSON.stringify({ reply: 'Fixed for real.', plan: invalid }),
      ],
    });
    const reply = await node.chat(ctx, 'dedupe the steps');
    expect(observ.startAgentInputs).toHaveLength(2); // the initial turn + ONE retry
    expect(observ.labels).toEqual(['plan chat', 'plan chat retry']);
    expect(observ.savedMetas).toHaveLength(0); // no partial version ever persisted
    // the pipeline's typed `output_retry` event (step 05) names the retry
    expect(observ.events).toContain('plan chat: output contract failed — retrying with feedback (schema_mismatch)');
    expect(observ.events).toContain('plan refine failed validation — nothing was changed');
    expect(reply).toContain("I couldn't produce a valid plan for that —");
    expect(reply).toContain('duplicate step id');
    expect(reply).toContain('nothing was changed');
  });

  it('the retry machine heals a valid second turn: the version lands, the reply carries', async () => {
    const invalid = { ...validPlanPayload, steps: [step('s1', 'First'), step('s1', 'Again')] };
    const { node, observ } = chatNode({
      responses: [
        JSON.stringify({ reply: 'Fixed.', plan: invalid }),
        JSON.stringify({ reply: 'Fixed for real.', plan: validPlanPayload }),
      ],
    });
    const reply = await node.chat(ctx, 'dedupe the steps');
    expect(reply).toBe('Fixed for real.');
    expect(observ.savedMetas).toHaveLength(1);
    expect((observ.savedMetas[0] as Record<string, unknown>).refinedFrom).toEqual({ version: 2, source: 'chat' });
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
  });

  it('apply after sendChat claim: a running node still persists the plan when the turn completes', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Planned.', plan: validPlanPayload })],
      status: 'running',
    });
    const reply = await node.chat(ctx, 'first turn');
    expect(reply).toBe('Planned.');
    expect(observ.savedMetas).toHaveLength(1);
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
  });

  it('the plan_refine feedback turn carries the developer message + the follow-up contract', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Answered.' })],
    });
    await node.chat(ctx, 'why is step 2 blocked?');
    const turn = observ.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toContain('why is step 2 blocked?');
    expect(turn.prompt).toContain('The conversation continues');
    expect(turn.prompt).toContain('"reply"');
  });

  it('guard refusal per §3b: a done node keeps its state; the reply answers AND explains', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'On it.', plan: validPlanPayload })],
      status: 'done',
    });
    const reply = await node.chat(ctx, 'move step 2');
    expect(reply).toContain('On it.');
    expect(reply).toContain("can't update the plan while it is done");
    expect(observ.savedMetas).toHaveLength(0);
    expect(observ.events).toContain('plan update ignored — node done');
  });

  it('the turn\'s OWN sendChat claim does not refuse the apply — the guard fences on the attempt (regression)', async () => {
    // the production timeline: sendChat claims (running + attempt) BEFORE the
    // turn dispatches, and the engine hands over the pre-claim status
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Moved step 2 below step 1.', plan: validPlanPayload })],
      claimed: 'att_chat',
    });
    const reply = await node.turn(ctx, 'move step 2 below step 1', {
      model: 'm',
      thread: null,
      previousStatus: 'awaiting_approval',
    });
    expect(reply).toBe('Moved step 2 below step 1.');
    expect(observ.events).not.toContain('plan update ignored — node running');
    // the refine landed + the node came back off the claimed running state
    expect(observ.savedMetas).toHaveLength(1);
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
    expect(observ.nodePatches.some(p => p.status === 'running')).toBe(false);
  });

  it('a reply-only turn on a claimed node restores the PRE-claim status — no stuck running', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Answered: step 2 is blocked.' })],
      claimed: 'att_chat',
    });
    const reply = await node.turn(ctx, 'why is step 2 blocked?', {
      model: 'm',
      thread: null,
      previousStatus: 'awaiting_approval',
    });
    expect(reply).toBe('Answered: step 2 is blocked.');
    expect(observ.savedMetas).toHaveLength(0);
    // the revert wrote the pre-claim status back (the old bug wrote `running` here)
    expect(observ.nodePatches).toContainEqual(
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
    expect(observ.nodePatches.some(p => p.status === 'running')).toBe(false);
  });

  it('guard refusal per §3b: an approved plan refuses mid-build the same way', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Sure.', plan: validPlanPayload })],
      status: 'approved',
    });
    const reply = await node.chat(ctx, 'add a step');
    expect(reply).toContain("can't update the plan while it is approved");
    expect(observ.savedMetas).toHaveLength(0);
    expect(observ.events).toContain('plan update ignored — node approved');
  });

  it('a first apply on a pending node (not UI-reachable; contract-required) lands version 1 → awaiting_approval', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Planned.', plan: validPlanPayload })],
      status: 'pending',
      prevRow: null, // no plan yet: the FIRST apply
    });
    const reply = await node.chat(ctx, 'start this');
    expect(reply).toBe('Planned.');
    expect(observ.savedMetas).toHaveLength(1);
    // no previous version: the refine provenance records version 0
    expect((observ.savedMetas[0] as Record<string, unknown>).refinedFrom).toEqual({ version: 0, source: 'start' });
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
  });

  it('a failed node accepts the apply as the rescue path (§3b): status → awaiting_approval', async () => {
    const { node, observ } = chatNode({
      responses: [JSON.stringify({ reply: 'Recovered.', plan: validPlanPayload })],
      status: 'failed',
    });
    const reply = await node.chat(ctx, 'fix and re-plan');
    expect(reply).toBe('Recovered.');
    const art = observ.savedArts[0];
    expect(art).toBeDefined();
    expect(observ.nodePatches.some(p => p.status === 'awaiting_approval')).toBe(true);
    expect(observ.events).toContain(`plan v${art.version} ready for review · 2 steps`);
  });
});

describe('resolvePlanFailedRetryStatus — no recorded turn revert targets', () => {
  it('returns pending when there is no plan artifact and no safe previousStatus', () => {
    expect(resolvePlanFailedRetryStatus(PlanInput.parse({}), false)).toBe(NODE_STATUS.PENDING);
  });

  it('returns awaiting_approval when a plan version exists and previousStatus is absent', () => {
    expect(resolvePlanFailedRetryStatus(PlanInput.parse({}), true)).toBe(NODE_STATUS.AWAITING_APPROVAL);
  });

  it('honors a safe previousStatus over the artifact fallback', () => {
    expect(
      resolvePlanFailedRetryStatus(
        PlanInput.parse({ previousStatus: NODE_STATUS.AWAITING_APPROVAL }),
        false,
      ),
    ).toBe(NODE_STATUS.AWAITING_APPROVAL);
  });

  it('skips running/failed previousStatus and falls back to awaiting_approval when a plan exists', () => {
    expect(
      resolvePlanFailedRetryStatus(PlanInput.parse({ previousStatus: NODE_STATUS.RUNNING }), true),
    ).toBe(NODE_STATUS.AWAITING_APPROVAL);
  });
});

describe('resolvePlanTurnPreviousStatus — revert target while claimed running', () => {
  it('uses prior input previousStatus when the live row is running', () => {
    expect(
      resolvePlanTurnPreviousStatus(
        NODE_STATUS.RUNNING,
        PlanInput.parse({ previousStatus: NODE_STATUS.AWAITING_APPROVAL }),
      ),
    ).toBe(NODE_STATUS.AWAITING_APPROVAL);
  });

  it('uses the live status when the node is not running', () => {
    expect(
      resolvePlanTurnPreviousStatus(NODE_STATUS.AWAITING_APPROVAL, PlanInput.parse({})),
    ).toBe(NODE_STATUS.AWAITING_APPROVAL);
  });
});
