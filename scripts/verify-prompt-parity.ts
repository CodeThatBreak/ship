import "./parity-env";

/**
 * Prompt parity check (Phase 1 of docs/prompt-flow-fix-plan.md).
 *
 * Verifies the invariant Phase 1 exists for — the recorded per-run prompt is
 * the exact prompt the agent received — plus the PromptPreview overlay:
 *
 *   1. nodes.input.prompt === AgentStartSpec.prompt        (byte-identical)
 *   2. promptPreview.previewFor(...).lastRun === nodes.input.prompt right
 *      after the run (diverges noted as informational wherever the preview's
 *      run-data fill differs — plan context, build checklist, diff/comments
 *      are finalized at run time)
 *
 * Runs against a SCRATCH database in the OS temp dir (parity-env sets
 * DATABASE_PATH before the engine loads) — never against the demo or the
 * production DB. The agent port + git host are fixture stubs; no network.
 *
 * No test runner in this repo (D5) — compile with scripts/tsconfig.parity.json
 * (CommonJS output + the app's `@/*` alias) and run with plain `node`:
 *
 *   npx tsc -p scripts/tsconfig.parity.json
 *   mkdir -p node_modules/.cache/promptparity/shims/server-only
 *   printf 'module.exports = {};' > node_modules/.cache/promptparity/shims/server-only/index.js
 *   printf '{"name":"server-only","main":"index.js"}' > node_modules/.cache/promptparity/shims/server-only/package.json
 *   NODE_PATH="$PWD/node_modules/.cache/promptparity/shims" \
 *     NODE_OPTIONS="--require=$PWD/scripts/parity-alias-hook.cjs" \
 *     node node_modules/.cache/promptparity/scripts/verify-prompt-parity.js
 *
 * Two loaders make plain `node` work: the NODE_PATH shim satisfies the
 * `server-only` package (the repo builds through Next's alias), and
 * parity-alias-hook.cjs rewrites literal `require("@/x")` paths onto this
 * compiled tree (tsc emits every graph-reachable file, components/ included).
 */

import { db } from "../lib/db";
import { agentPortRegistry, type AgentPort, type AgentStarted, type AgentStartSpec, type AgentStreamOutcome } from "../lib/engine/ports/agent-runner";
import { gitHostRegistry, type ChangeRequest, type GitHostService } from "../lib/engine/ports/git-host";
import { usageTracker, type RunCostSummary } from "../lib/engine/nodes/base/usage-tracker";
import type { NodeDefinition } from "../lib/engine/nodes/base";
import { nodeRoles } from "../lib/engine/nodes/base/node-roles";
import { FlowRow, Task, NodeRow, rows } from "../lib/db/rows";
import { nodeRegistry } from "../lib/engine/nodes/registry";
import { promptPreview } from "../lib/engine/prompt-preview";
import { NODE_KEYS } from "../lib/engine/nodes/keys";

// ── runtime stubs ─────────────────────────────────────────────────────────────
const capturedSpecs: string[] = [];
// Patch the registered cloud port in place (the engine resolves it via
// agentPortRegistry.forMode("cloud") — see CursorCloudAgentPort registration).
const cloud = agentPortRegistry.forMode("cloud");
Object.assign(cloud, {
  start(spec: AgentStartSpec): Promise<AgentStarted> {
    capturedSpecs.push(spec.prompt);
    return Promise.resolve({ agentId: "fixture-agent", runId: "fixture-run" });
  },
  stream(): Promise<AgentStreamOutcome> {
    return Promise.resolve({
      result: { status: "finished", result: "FIXTURE RUN RESULT", sessionId: "fixture-session", durationMs: 10, usage: null },
    });
  },
} satisfies Partial<AgentPort>);
const usageAccess = usageTracker as unknown as Record<string, unknown>;
usageAccess.captureRunUsage = async (): Promise<RunCostSummary> => ({});
usageAccess.persistUsage = (): void => {};

const FIXTURE_REPO_URL = "https://fixture.invalid/repo.git";
const fixtureCR: ChangeRequest = {
  id: "fixture-101", number: 101, title: "parity MR", state: "opened", webUrl: FIXTURE_REPO_URL,
  sourceBranch: "parity/mr-branch", targetBranch: "main", sha: "fixt0123456789", headPipeline: null, projectId: 42,
};
const noop = (): unknown => ({});
const throwNo = async (): Promise<never> => { throw new Error("fixture: unsupported"); };
const fixtureHost: GitHostService = {
  kind: "fixture",
  label: "Fixture",
  configured: () => true,
  ownsRepo: (u: string) => u === FIXTURE_REPO_URL,
  clientForRepo: noop as unknown as GitHostService["clientForRepo"],
  authedCloneUrl: (u: string) => u,
  instances: () => [],
  addInstance: noop as unknown as GitHostService["addInstance"],
  updateInstance: noop as unknown as GitHostService["updateInstance"],
  removeInstance: noop as unknown as GitHostService["removeInstance"],
  testInstance: async () => ({ ok: true, detail: "fixture" }),
  verifyWebhook: () => true,
  parseWebhook: () => null,
  // engine-facing surface. getChanges returns EMPTY diffs so the review run's
  // data blocks stay byte-comparable with the preview's empty run-data slots
  getChangeRequest: async () => fixtureCR,
  createChangeRequest: async () => fixtureCR,
  listChangeRequestsByBranch: async () => [],
  getChanges: async () => ({ changes: [] }),
  getPipeline: throwNo,
  createCRPipeline: throwNo,
  createPipeline: throwNo,
  listPipelineJobs: async () => [],
  playJob: async () => ({}),
  retryPipeline: throwNo,
  getJobTrace: async () => "",
  listComments: async () => [],
  createComment: async () => ({}),
  resolveComment: async () => ({}),
  getProject: async () => ({ id: 42, name: "fixture", pathWithNamespace: "fixture/repo", defaultBranch: "main" }),
};

interface RowResult {
  kind: string;
  status: "PASS" | "FAIL" | "SKIP";
  /** nodes.input.prompt === AgentStartSpec.prompt — the Phase-1 core invariant */
  recordedSent: boolean | null;
  /** informational: the live preview equals the recorded run prompt */
  previewEqualsRun: boolean | null;
  /** informational: the service overlay reports lastRun == recorded */
  overlayOk: boolean | null;
  diverges: boolean | null;
  note: string;
}

async function main(): Promise<void> {
  gitHostRegistry.register(fixtureHost); // unique kind — the scratch db is fresh

  // ── fixture DB rows ────────────────────────────────────────────────────────
  const now = () => new Date().toISOString();
  const taskId = "PARITY-1";
  db.run(
    `INSERT INTO tasks (id, type, fields, key, summary, description, status, issue_type) VALUES (?,?,?,?,?,?,?,?)`,
    taskId, "jira", JSON.stringify({ prd: "# PRD\nparity fixture PRD" }), taskId, "Parity fixture ticket",
    "desc", "open", "bug",
  );
  const flowId = "flow_fixture_sdlc";
  db.run(
    `INSERT INTO flows (id, task_id, name, status, mr_url, mr_iid, mr_branch, repo_url, execution_mode, current_node, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    flowId, taskId, "parity flow", "active", null, 101, "parity/mr-branch", FIXTURE_REPO_URL, "cloud", null, now(), now(),
  );
  const parentFlowId = "flow_fixture_parent";
  db.run(
    `INSERT INTO flows (id, task_id, name, status, mr_url, mr_iid, mr_branch, repo_url, execution_mode, current_node, parent_flow_id, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    parentFlowId, taskId, "parity parent flow", "active", null, null, null, FIXTURE_REPO_URL, "cloud", null, null, "sdlc", now(), now(),
  );
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?, 'pending', ?, ?)`,
    "node_fixture_art", parentFlowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN, now(), now(),
  );
  db.run(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, status, created_at) VALUES (?,?,?,?,1,?,?,?)`,
    "art_fixture_plan", "node_fixture_art", parentFlowId, "plan", "# PLAN\nPARITY PARENT PLAN", "approved", now(),
  );
  const childFlowId = "flow_fixture_step";
  db.run(
    `INSERT INTO flows (id, task_id, name, status, mr_url, mr_iid, mr_branch, repo_url, execution_mode, current_node, parent_flow_id, kind, trigger_payload, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    childFlowId, taskId, "parity step flow", "active", null, null, "parity/step-branch", FIXTURE_REPO_URL, "cloud", null, parentFlowId, "step",
    JSON.stringify({ step: { id: "s1", title: "Parity step", detail: null, files: ["a.ts"], branch: "parity/step-branch" }, siblings: [] }),
    now(), now(),
  );
  db.run(
    `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    "cmt_1", flowId, 101, "gl_disc_1", "Reviewer", "PARITY OPEN COMMENT", "a.ts", 3, "open", now(), now(),
  );
  for (const node of ["plan", "build", "review", "resolve"] as const) {
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?, 'pending', ?, ?)`,
      `node_fixture_${node}`, flowId, node, node, now(), now(),
    );
  }
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?, 'pending', ?, ?)`,
    "node_fixture_step_build", childFlowId, NODE_KEYS.STEP_BUILD, NODE_KEYS.STEP_BUILD, now(), now(),
  );
  // declarative agent def + its node row (resolved via nodeRegistry.resolve)
  const agDefId = "ag_fixture_parity";
  db.run(
    `INSERT INTO node_templates (id, key, name, kind, version, description, config, is_builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    agDefId, "parity-agent", "Parity agent", "agent", 1, null,
    JSON.stringify({ mode: "plan", prompt: "Do {{task.key}} with {{input.detail}}", output: "markdown" }),
    0, now(), now(),
  );
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?, 'pending', ?, ?)`,
    "node_fixture_agent", childFlowId, "parity-agent", agDefId, now(), now(),
  );

  const results: RowResult[] = [];

  /** Drive one run through the real def, then record the Phase-1 invariants. */
  const verifyRun = async (args: {
    kind: string;
    def: NodeDefinition<unknown, Record<string, unknown>>;
    flowId: string;
    nodeKey: string;
    input: unknown;
  }): Promise<string | null> => {
    const { kind, def, flowId: flow, nodeKey } = args;
    const flowRow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flow);
    const taskRow = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!flowRow || !taskRow) {
      results.push({ kind, status: "FAIL", recordedSent: null, previewEqualsRun: null, overlayOk: null, diverges: null, note: "fixture flow/task rows missing" });
      return null;
    }
    const ctx = { flow: flowRow, task: taskRow, repo: null };
    let previewFinal: string | null = null;
    try {
      previewFinal = nodeRoles.promptPreviewerOf(def)?.previewPrompt(
        ctx,
        rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flow, nodeKey) ?? null,
        {},
      )?.assembly.final ?? null;
    } catch { /* the preview must not gate the run-side check */ }

    const specStart = capturedSpecs.length;
    let runError: string | null = null;
    try {
      await def.run(ctx, def.parseInput(args.input), def.defaultConfig());
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e);
    }
    const specPrompt = capturedSpecs[specStart] ?? null;

    const rawInput = db.get<{ input: string | null }>(
      `SELECT input FROM nodes WHERE flow_id=? AND node_key=?`, flow, nodeKey)?.input;
    const recorded = rawInput ? (JSON.parse(rawInput) as Record<string, unknown>) : null;
    const recordedPrompt = typeof recorded?.prompt === "string" && recorded.prompt ? recorded.prompt : null;

    const recordedSent = recordedPrompt != null && specPrompt != null && recordedPrompt === specPrompt;
    const tripleBlank = recordedPrompt != null && /\n\n\n/.test(recordedPrompt);

    let overlayOk: boolean | null = null;
    let diverges: boolean | null = null;
    let overlayNote = "";
    const r = await promptPreview.previewFor(flow, new URL(`http://fixture.local/?node=${encodeURIComponent(nodeKey)}`));
    if (r.ok) {
      overlayOk = r.payload.lastRun === recordedPrompt;
      diverges = r.payload.diverges;
    } else if (kind === "agent") {
      overlayNote = "declarative preview pending Phase 2 (I10)";
    } else {
      overlayNote = `overlay: ${r.error}`;
    }

    const previewEqualsRun =
      previewFinal != null && recordedPrompt != null ? previewFinal === recordedPrompt : null;

    const notes: string[] = [];
    if (runError) notes.push(`run error: ${runError}`);
    if (recordedPrompt == null) notes.push("no recorded input.prompt");
    else if (specPrompt == null) notes.push("no captured agent start");
    else if (!recordedSent) notes.push("recorded != sent");
    if (tripleBlank) notes.push("recorded prompt has \\n\\n\\n (I7 whitespace leak)");
    if (overlayNote) notes.push(overlayNote);
    else if (overlayOk === false) notes.push("overlay lastRun != recorded");

    results.push({
      kind,
      status: recordedSent && !tripleBlank && (specPrompt != null || recordedPrompt != null) ? "PASS" : "FAIL",
      recordedSent,
      previewEqualsRun: previewEqualsRun ?? (previewFinal == null ? null : false),
      overlayOk: kind === "agent" ? null : overlayOk,
      diverges,
      note: notes.join("; ") || (previewEqualsRun === true ? "preview == recorded" : ""),
    });
    return recordedPrompt;
  };

  await verifyRun({ kind: "plan", def: nodeRegistry.get(NODE_KEYS.PLAN), flowId, nodeKey: NODE_KEYS.PLAN, input: { complex: false, decompose: false } });
  await verifyRun({ kind: "build", def: nodeRegistry.get(NODE_KEYS.BUILD), flowId, nodeKey: NODE_KEYS.BUILD, input: { plan: "PARITY PLAN CONTENT\n\nstep s1" } });
  await verifyRun({
    kind: "step_build",
    def: nodeRegistry.get(NODE_KEYS.STEP_BUILD),
    flowId: childFlowId,
    nodeKey: NODE_KEYS.STEP_BUILD,
    input: { step: { id: "s1", title: "Parity step", detail: null, files: ["a.ts"], branch: "parity/step-branch" }, prompt: null, feedback: null, model: null },
  });
  await verifyRun({ kind: "review", def: nodeRegistry.get(NODE_KEYS.REVIEW), flowId, nodeKey: NODE_KEYS.REVIEW, input: {} });
  await verifyRun({ kind: "resolve", def: nodeRegistry.get(NODE_KEYS.RESOLVE), flowId, nodeKey: NODE_KEYS.RESOLVE, input: {} });

  // ── declarative agent: rendered prompt === spec.prompt + prompt_source ─────
  {
    const flowRow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, childFlowId);
    const taskRow = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!flowRow || !taskRow) {
      results.push({ kind: "agent", status: "FAIL", recordedSent: null, previewEqualsRun: null, overlayOk: null, diverges: null, note: "fixture step-flow/task rows missing" });
    } else {
    const ctx = { flow: flowRow, task: taskRow, repo: null };
    const agDef = nodeRegistry.resolve(agDefId, "parity-agent");
    const specStart = capturedSpecs.length;
    let runError: string | null = null;
    try {
      await agDef.run(ctx, { prompt: null, model: null, detail: "DETAIL-VALUE" }, agDef.defaultConfig());
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e);
    }
    const specPrompt = capturedSpecs[specStart] ?? null;
    const rawInput = db.get<{ input: string | null }>(
      `SELECT input FROM nodes WHERE flow_id=? AND node_key=?`, childFlowId, "parity-agent")?.input;
    const recorded = rawInput ? (JSON.parse(rawInput) as Record<string, unknown>) : null;
    const recordedPrompt = typeof recorded?.prompt === "string" && recorded.prompt ? recorded.prompt : null;
    const recordedSent = recordedPrompt != null && specPrompt != null && recordedPrompt === specPrompt;
    const promptSource = typeof recorded?.prompt_source === "string" ? recorded.prompt_source : null;
    const notes: string[] = [];
    if (runError) notes.push(`run error: ${runError}`);
    if (!recordedSent) notes.push("recorded != rendered spec prompt");
    if (promptSource !== "config") notes.push(`unexpected prompt_source: ${promptSource ?? "missing"}`);
    results.push({
      kind: "agent",
      status: recordedSent && !runError && promptSource === "config" ? "PASS" : "FAIL",
      recordedSent,
      previewEqualsRun: null,
      overlayOk: null,
      diverges: null,
      note: notes.join("; ") || "rendered prompt recorded; prompt_source=config",
    });
    }
  }

  // ── pipeline: the gate's fix prompt is assembled inside runFix() — not
  //    simulable off-server; full parity rides the Phase-2 preview work (I5)
  {
    const flowRow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    const taskRow = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!flowRow || !taskRow) {
      results.push({ kind: "pipeline", status: "FAIL", recordedSent: null, previewEqualsRun: null, overlayOk: null, diverges: null, note: "fixture flow/task rows missing" });
    } else {
    const ctx = { flow: flowRow, task: taskRow, repo: null };
    const pipeDef = nodeRegistry.get(NODE_KEYS.PIPELINE);
    const previewChars = nodeRoles.promptPreviewerOf(pipeDef)?.previewPrompt(ctx, null, {})?.assembly.final.length ?? null;
    results.push({
      kind: "pipeline",
      status: "SKIP",
      recordedSent: null,
      previewEqualsRun: null,
      overlayOk: null,
      diverges: null,
      note: `fix prompt assembled inside runFix — exercised in the Phase-2 preview work (I5); preview chars: ${previewChars ?? "none"}`,
    });
    }
  }

  // ── report ─────────────────────────────────────────────────────────────────
  console.log("\nprompt parity — recorded==sent / overlay / preview");
  let failed = 0;
  for (const r of results) {
    if (r.status === "FAIL") failed++;
    const line = [
      r.kind,
      r.status,
      fmt(r.recordedSent),
      fmt(r.overlayOk),
      r.diverges == null ? "-" : String(r.diverges),
      r.note.endsWith("preview == recorded") ? `preview==run: ${fmt(r.previewEqualsRun)}` : `preview==run: ${fmt(r.previewEqualsRun)}`,
      r.note,
    ];
    console.log(line.map((s, i) => (i < 6 ? s.padEnd(13) : s)).join(""));
  }
  if (failed > 0) {
    console.error(`\n${failed} failing row(s)`);
    process.exitCode = 1;
  } else {
    console.info("\nAll parity checks passed.");
  }
}

const fmt = (v: boolean | null) => (v == null ? "-" : v ? "yes" : "NO");

main().catch((e: unknown) => {
  console.error("parity driver crashed:", e);
  process.exitCode = 1;
});
