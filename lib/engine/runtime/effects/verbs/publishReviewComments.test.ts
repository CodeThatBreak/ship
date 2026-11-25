import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../../../tests/helpers/testDatabase";

// Must run before any `db` import touches the connection — dynamic imports
// below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("../../../../db/app");
const { flowEngine } = await import("../../../flowEngine");
const { templateStore } = await import("../../../templates/templateStore");
const { EFFECT_VERB } = await import("../constants/effectVerbs");
const { TRIGGER_SOURCE } = await import("../../triggers/constants/triggerSources");
const { verbRegistry } = await import("./verbWiring");
const { EffectContractViolation } = await import("./effectContractViolation");
const { ARTIFACT_KIND } = await import("../../../constants/vocabulary");
const { REVIEW_VERDICT } = await import("../../../nodes/kinds/review/constants/reviewVerdict");
const { FLOW_STATUS } = await import("@/constants/flow");
const { testGet, testRun } = await import("@/tests/helpers/rawTestDb");
const { FlowHarness } = await import("@/tests/helpers/flowHarness");
const { registerFakeAgentPort } = await import("@/tests/helpers/fakeAgentPort");
const { registerFakeGitHost } = await import("@/tests/helpers/fakeGitHost");

let agent: import("@/tests/helpers/fakeAgentPort").FakeAgentPort;
let git: import("@/tests/helpers/fakeGitHost").FakeGitHost;
let harness: import("@/tests/helpers/flowHarness").FlowHarness;

beforeAll(async () => {
  await resetTestDatabase();
  agent = registerFakeAgentPort((value) => {
    void db.setSetting("default_harness", value);
  });
  await db.setSetting("default_harness", agent.harness);
  git = registerFakeGitHost();
  harness = new FlowHarness({ db, flowEngine, templateStore });
});

const TEMPLATE_COUNT = { n: 0 };

/** A declarative agent node template with the given config (the verb fixture:
 *  the run publishes the review comments; `effects` declares the verb). */
const seedVerbTemplate = async (config: Record<string, unknown>): Promise<string> => {
  TEMPLATE_COUNT.n += 1;
  const row = await templateStore.createNodeTemplate({
    key: `prc_verb_fixture_${TEMPLATE_COUNT.n}`,
    name: `PRC verb fixture ${TEMPLATE_COUNT.n}`,
    kind: "agent",
    config: {
      mode: "plan",
      prompt: "Review the diff",
      output: "json",
      ...config,
    },
  });
  return row.id;
};

/** The established `change_request` fact — a branch row carrying its MR
 *  (`FactStore.changeRequestFact`'s latest-with-MR resolution). */
const seedChangeRequestFact = async (flowId: string, branch: string, mrIid: number): Promise<void> => {
  await testRun(
    `INSERT INTO branches (id, flow_id, name, title, status, created_at, updated_at, mr_iid, mr_url)
     VALUES ($1,$2,$3,$3,'approved',$4,$4,$5,$6)`,
    db.uid("br_"), flowId, branch, "2026-01-01T00:00:00Z", mrIid, `https://git.example.com/mr/${mrIid}`,
  );
};

const reviewArtifactMeta = async (flowId: string): Promise<Record<string, unknown> | null> => {
  const row = await testGet<{ meta: Record<string, unknown> | null }>(
    `SELECT meta FROM artifacts WHERE flow_id=$1 AND kind=$2 ORDER BY version DESC LIMIT 1`,
    flowId,
    ARTIFACT_KIND.REVIEW,
  );
  return row?.meta ?? null;
};

const inlineCalls = () =>
  git.calls.filter(
    (c): c is Extract<import("@/tests/helpers/fakeGitHost").GitHostCall, { kind: "createInlineComment" }> =>
      c.kind === "createInlineComment",
  );

const noteCalls = () =>
  git.calls.filter(
    (c): c is Extract<import("@/tests/helpers/fakeGitHost").GitHostCall, { kind: "createComment" }> =>
      c.kind === "createComment",
  );

/** The verb context the wildcard dispatch carries (identity only — the verb
 *  reads the node's published output through the node row itself). */
const verbCtxOf = (flowId: string, nodeKey: string, defKey: string) => ({
  flowId,
  nodeKey,
  defKey,
  status: FLOW_STATUS.DONE,
  output: null,
  source: TRIGGER_SOURCE.EFFECT,
});

describe("publish_review_comments verb (task 19 — design §4.2 use case 7)", () => {
  it("a declarative review node's afterSuccess posts the comments inline and stamps the ledger + verdict", async () => {
    const templateId = await seedVerbTemplate({
      effects: { afterSuccess: [EFFECT_VERB.PUBLISH_REVIEW_COMMENTS] },
    });
    const flowId = await harness.seedInlineFlow([{ key: "review", def: templateId }], []);
    await seedChangeRequestFact(flowId, "feat/review", 21);
    git.addChangeRequest({ number: 21 });

    agent.pushRun({
      status: "finished",
      result: JSON.stringify({
        comments: [
          { file: "src/a.ts", line: 12, body: "Unused variable." },
          { body: "Overall the error handling is thin." },
        ],
        verdict: REVIEW_VERDICT.APPROVE,
      }),
    });

    // the run's afterSuccess door dispatched the declared verb under the
    // node's claim — the host saw the inline comment + the fallback note
    await flowEngine.startNodeStage(flowId, "review");
    expect(await harness.nodeStatus(flowId, "review")).toBe(FLOW_STATUS.DONE);

    const inline = inlineCalls();
    expect(inline).toHaveLength(1);
    expect(inline[0]?.crNumber).toBe(21);
    expect(inline[0]?.input).toMatchObject({ path: "src/a.ts", line: 12, body: "**AI Review**\n\nUnused variable." });
    const notes = noteCalls();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("**AI Review**\n\nOverall the error handling is thin.");

    // the ledger + the verdict stamped into the review artifact's meta — the
    // artifact is the human-facing projection (the run output is the fact)
    const meta = await reviewArtifactMeta(flowId);
    expect(meta).toMatchObject({ posted: 2, mrIid: 21, branchName: "feat/review", review_verdict: "approve" });
    expect(Array.isArray(meta?.postedHashes)).toBe(true);
    expect(meta?.postedHashes).toHaveLength(2);

    // the verdict fact is consumable by a downstream contract: the flow
    // context exposes the run's contract-validated output, so a downstream
    // node's template/`consumes` contract reads the verdict
    const ctx = await flowEngine.ctx(flowId);
    const { buildFlowContext } = await import("../../../context/flowVariables");
    const { TemplateRenderer } = await import("../../../nodes/shared/templateRenderer");
    const rendered = TemplateRenderer.render("[{{nodes.review.output.verdict}}]", await buildFlowContext(ctx));
    expect(rendered).toBe(`[${REVIEW_VERDICT.APPROVE}]`);

    // idempotent re-run: the ledger holds both hashes — no second post
    const inlineBefore = inlineCalls().length;
    const notesBefore = noteCalls().length;
    const ranAgain = await verbRegistry.run(
      EFFECT_VERB.PUBLISH_REVIEW_COMMENTS,
      verbCtxOf(flowId, "review", templateId),
    );
    expect(ranAgain).toBe(false);
    expect(inlineCalls().length).toBe(inlineBefore);
    expect(noteCalls().length).toBe(notesBefore);
  });

  it("the summary style posts one note per pending comment and never double-posts", async () => {
    const templateId = await seedVerbTemplate({ comment_style: "summary" });
    const flowId = await harness.seedInlineFlow([{ key: "review", def: templateId }], []);
    await seedChangeRequestFact(flowId, "feat/summary", 22);
    git.addChangeRequest({ number: 22 });

    const output = {
      comments: [
        { file: "src/b.ts", line: 3, body: "Rename this." },
        { file: "src/c.ts", line: 8, body: "Add a test." },
      ],
    };
    await harness.setNodeOutputForFixture(flowId, "review", FLOW_STATUS.DONE, output);

    const notesBefore = noteCalls().length;
    const ran = await verbRegistry.run(EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, verbCtxOf(flowId, "review", templateId));
    expect(ran).toBe(true);

    const notes = noteCalls();
    expect(notes.length).toBe(notesBefore + 1);
    expect(notes[notesBefore]?.body).toContain("- `src/b.ts:3` — Rename this.");
    expect(notes[notesBefore]?.body).toContain("- `src/c.ts:8` — Add a test.");

    // re-run: every hash is in the ledger — no second summary note
    const ranAgain = await verbRegistry.run(EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, verbCtxOf(flowId, "review", templateId));
    expect(ranAgain).toBe(false);
    expect(noteCalls().length).toBe(notesBefore + 1);
  });

  it("without a change_request fact the verb fails loudly — no host call", async () => {
    const templateId = await seedVerbTemplate({});
    const flowId = await harness.seedInlineFlow([{ key: "review", def: templateId }], []);
    await harness.setNodeOutputForFixture(flowId, "review", FLOW_STATUS.DONE, { comments: [{ body: "note" }] });
    const before = git.calls.length;

    await expect(
      verbRegistry.run(EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, verbCtxOf(flowId, "review", templateId)),
    ).rejects.toThrow(EffectContractViolation);

    // the typed event names the verb and the missing fact, on the node
    const data = await testGet<{ data: { verb: string; fact: string; nodeKey: string } }>(
      `SELECT data FROM events WHERE flow_id=$1 AND type='effect_contract_violation'`,
      flowId,
    );
    expect(data?.data).toMatchObject({ verb: EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, fact: "change_request", nodeKey: "review" });
    expect(git.calls.length).toBe(before);
  });

  it("an output with no parseable review comments refuses loudly — no host call", async () => {
    const templateId = await seedVerbTemplate({});
    const flowId = await harness.seedInlineFlow([{ key: "review", def: templateId }], []);
    await seedChangeRequestFact(flowId, "feat/empty", 23);
    const before = git.calls.length;

    await harness.setNodeOutputForFixture(flowId, "review", FLOW_STATUS.DONE, { markdown: "# no comments here" });
    await expect(
      verbRegistry.run(EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, verbCtxOf(flowId, "review", templateId)),
    ).rejects.toThrow(EffectContractViolation);

    await harness.setNodeOutputForFixture(flowId, "review", FLOW_STATUS.DONE, {});
    await expect(
      verbRegistry.run(EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, verbCtxOf(flowId, "review", templateId)),
    ).rejects.toThrow(EffectContractViolation);

    expect(git.calls.length).toBe(before);
  });

  it("a clean review (approve, no comments) is a no-op — not a contract violation", async () => {
    const templateId = await seedVerbTemplate({ effects: { afterSuccess: [EFFECT_VERB.PUBLISH_REVIEW_COMMENTS] } });
    const flowId = await harness.seedInlineFlow([{ key: "review", def: templateId }], []);
    await seedChangeRequestFact(flowId, "feat/clean", 25);
    const before = git.calls.length;

    await harness.setNodeOutputForFixture(flowId, "review", FLOW_STATUS.DONE, {
      verdict: REVIEW_VERDICT.APPROVE,
      comments: [],
    });
    const ran = await verbRegistry.run(EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, verbCtxOf(flowId, "review", templateId));

    // nothing to post: the verb reports "claimed nothing" and never calls the host
    expect(ran).toBe(false);
    expect(git.calls.length).toBe(before);
  });

  it("max_comments caps the posted comments (the config knob the built-in reads)", async () => {
    const templateId = await seedVerbTemplate({ max_comments: 1 });
    const flowId = await harness.seedInlineFlow([{ key: "review", def: templateId }], []);
    await seedChangeRequestFact(flowId, "feat/cap", 24);
    git.addChangeRequest({ number: 24 });
    await harness.setNodeOutputForFixture(flowId, "review", FLOW_STATUS.DONE, {
      comments: [
        { file: "src/a.ts", line: 1, body: "First." },
        { file: "src/b.ts", line: 2, body: "Second." },
      ],
    });

    const inlineBefore = inlineCalls().length;
    const ran = await verbRegistry.run(EFFECT_VERB.PUBLISH_REVIEW_COMMENTS, verbCtxOf(flowId, "review", templateId));
    expect(ran).toBe(true);
    expect(inlineCalls().length).toBe(inlineBefore + 1);
    const meta = await reviewArtifactMeta(flowId);
    expect(meta?.posted).toBe(1);
  });
});
