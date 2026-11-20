/**
 * ⚠️ ONE-OFF migration script (step 01, task 4) ⚠️
 * Migrates the legacy better-sqlite3 database to Postgres via Prisma.
 * Delete this file once every deployment has been moved to Postgres.
 *
 * What it does:
 *   - reads the legacy sqlite file with better-sqlite3 (the package stays one
 *     extra step just for this reader — see step-01 doc, "Delete" section),
 *   - writes through Prisma in batched transactions against the target PG
 *     database (`--url` or DATABASE_URL),
 *   - is idempotent: TRUNCATEs the target tables first,
 *   - refuses to run unless the target database name is a demo/dev database
 *     (`devflow` / `devflow_test`) — never `devflow_prod` — unless the
 *     explicit `--i-know-what-im-doing` flag is passed (which still never
 *     unlocks `devflow_prod`),
 *   - verifies afterwards: per-table row counts vs source + a JSONB round-trip
 *     spot-check on `nodes.input/output` and `artifacts.meta` (parsed JSON
 *     deep equality on a sample of rows). Exits non-zero on any mismatch.
 *
 * Conversion rules:
 *   - TEXT ISO timestamps → Date objects (timestamptz columns),
 *   - sqlite booleans (0/1) → PG booleans,
 *   - JSON columns that stored strings → parsed JSON objects,
 *   - ids preserved as-is,
 *   - `tasks.fields.figma_urls` is camelCased to `figmaUrls` — the only
 *     payload key the app migrated (see lib/db/rows.ts Task transform); every
 *     other JSONB payload passes through unchanged.
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-pg.mjs \
 *     [--source ./data/devflow-clean-demo.db] \
 *     [--url postgresql://devflow:devflow@localhost:5432/devflow_test]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Database from "better-sqlite3";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
};
const SOURCE = path.resolve(root, argOf("--source") ?? "./data/devflow-clean-demo.db");
const TARGET_URL = (argOf("--url") ?? process.env.DATABASE_URL ?? "").trim() ||
  "postgresql://devflow:devflow@localhost:5432/devflow";

// ── target guard: demo/dev databases only, never the production database ────
const databaseNameFromUrl = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "").split("?")[0]);
  } catch {
    return "";
  }
};
const DEMO_DBS = new Set(["devflow", "devflow_test"]);
const targetDb = databaseNameFromUrl(TARGET_URL);
if (!targetDb) {
  console.error(`Cannot parse a database name out of ${TARGET_URL} — refusing to run.`);
  process.exit(1);
}
if (targetDb === "devflow_prod") {
  console.error(`Refusing to migrate into the production database (devflow_prod).`);
  process.exit(1);
}
if (!DEMO_DBS.has(targetDb) && !argv.includes("--i-know-what-im-doing")) {
  console.error(
    `Refusing to migrate into "${targetDb}".\n` +
      `Only the demo/dev databases (devflow, devflow_test) are allowed.\n` +
      `Pass --url postgresql://…/<demo db>, or --i-know-what-im-doing (dangerous).`,
  );
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) {
  console.error(`Source sqlite file not found: ${SOURCE}`);
  process.exit(1);
}

console.log(`sqlite source:  ${SOURCE}`);
console.log(`postgres target: ${targetDb} (${TARGET_URL.replace(/:[^:@/]+@/, ":***@")})`);

const sqlite = new Database(SOURCE, { readonly: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TARGET_URL }),
});

// ── converters ───────────────────────────────────────────────────────────────

const ts = (v, ctx) => {
  if (v == null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`bad timestamp ${JSON.stringify(v)} in ${ctx}`);
  return d;
};

const bool = (v) => {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (v === 1) return true;
  if (v === 0) return false;
  throw new Error(`not a sqlite boolean: ${JSON.stringify(v)}`);
};

/**
 * Boolean column that is NOT NULL with a default — legacy rows (columns added
 * by later migrations) hold NULL; fall back to the Prisma schema default.
 */
const boolDefault = (v, fallback) => bool(v) ?? fallback;

const json = (v, ctx) => {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    throw new Error(`bad JSON in ${ctx}: ${e.message}`);
  }
};

/** JSON columns that are NOT NULL with a default — legacy '' / NULL becomes the default. */
const jsonDefault = (v, ctx, fallback = {}) =>
  v == null || v.trim() === "" ? fallback : json(v, ctx);

/** The one payload camelCase the app migrated (lib/db/rows.ts Task). */
const taskFields = (v) => {
  const fields = jsonDefault(v, "tasks.fields");
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    if ("figma_urls" in fields) {
      const { figma_urls, ...rest } = fields;
      return { ...rest, figmaUrls: figma_urls };
    }
  }
  return fields;
};

// ── table specs (FK-safe insert order; parents before children) ──────────────
// Names mirror prisma/schema.prisma models — kept in snake_case as the tables
// are mapped via @@map.
const TABLES = [
  ["task", "tasks", (r) => ({
    id: r.id, type: r.type, fields: taskFields(r.fields), key: r.key, summary: r.summary,
    description: r.description, status: r.status, issueType: r.issue_type,
    priority: r.priority, repoUrl: r.repo_url, parentKey: r.parent_key,
    externalUrl: r.external_url, raw: r.raw, syncedAt: ts(r.synced_at, `task ${r.id}`),
  })],
  ["repo", "repos", (r) => ({
    id: r.id, name: r.name, cloudUrl: r.cloud_url, localPath: r.local_path,
    defaultBranch: r.default_branch, useWorktrees: boolDefault(r.use_worktrees, true),
    installCommand: r.install_command, skipInstall: boolDefault(r.skip_install, false),
    syncPaths: r.sync_paths, sharedDirs: r.shared_dirs, setupCommand: r.setup_command,
    worktreeTimeoutMs: r.worktree_timeout_ms,
    createdAt: ts(r.created_at, `repo ${r.id}`), updatedAt: ts(r.updated_at, `repo ${r.id}`),
  })],
  ["gitlabInstance", "gitlab_instances", (r) => ({
    id: r.id, name: r.name, baseUrl: r.base_url, token: r.token,
    createdAt: ts(r.created_at, `gitlab_instance ${r.id}`),
  })],
  ["jiraInstance", "jira_instances", (r) => ({
    id: r.id, name: r.name, baseUrl: r.base_url, email: r.email, token: r.token,
    createdAt: ts(r.created_at, `jira_instance ${r.id}`),
  })],
  ["setting", "settings", (r) => ({ key: r.key, value: r.value })],
  ["flowTemplate", "flow_templates", (r) => ({
    id: r.id, name: r.name, description: r.description, version: r.version,
    isBuiltin: boolDefault(r.is_builtin, false), trigger: jsonDefault(r.trigger, `flow_template ${r.id}`),
    scheduleNextAt: ts(r.schedule_next_at, `flow_template ${r.id}`),
    hidden: boolDefault(r.hidden, false),
    createdAt: ts(r.created_at, `flow_template ${r.id}`),
    updatedAt: ts(r.updated_at, `flow_template ${r.id}`),
  })],
  ["nodeTemplate", "node_templates", (r) => ({
    id: r.id, key: r.key, name: r.name, kind: r.kind, version: r.version,
    description: r.description, icon: r.icon,
    config: jsonDefault(r.config, `node_template ${r.id}`),
    isBuiltin: boolDefault(r.is_builtin, false), templateId: r.template_id,
    createdAt: ts(r.created_at, `node_template ${r.id}`),
    updatedAt: ts(r.updated_at, `node_template ${r.id}`),
  })],
  ["flowTemplateNode", "flow_template_nodes", (r) => ({
    id: r.id, templateId: r.template_id, nodeKey: r.node_key, nodeTemplateId: r.node_template_id,
    label: r.label, trigger: jsonDefault(r.trigger, `flow_template_node ${r.id}`),
    joinMode: r.join_mode, config: jsonDefault(r.config, `flow_template_node ${r.id}`),
    inputMap: jsonDefault(r.input_map, `flow_template_node ${r.id}`),
    x: r.x, y: r.y,
    createdAt: ts(r.created_at, `flow_template_node ${r.id}`),
    updatedAt: ts(r.updated_at, `flow_template_node ${r.id}`),
  })],
  ["flowTemplateEdge", "flow_template_edges", (r) => ({
    id: r.id, templateId: r.template_id, fromKey: r.from_key, toKey: r.to_key,
    kind: r.kind, label: r.label, condition: r.condition,
    createdAt: ts(r.created_at, `flow_template_edge ${r.id}`),
    updatedAt: ts(r.updated_at, `flow_template_edge ${r.id}`),
  })],
  ["flow", "flows", (r) => ({
    id: r.id, taskId: r.task_id, name: r.name, status: r.status,
    mrUrl: r.mr_url, mrIid: r.mr_iid, mrBranch: r.mr_branch, repoUrl: r.repo_url,
    gitlabProjectId: r.gitlab_project_id,
    executionMode: r.execution_mode ?? "cloud", repoId: r.repo_id,
    templateId: r.template_id, templateGraph: json(r.template_graph, `flow ${r.id}`),
    triggerPayload: json(r.trigger_payload, `flow ${r.id}`), worktreeDir: r.worktree_dir,
    parentFlowId: r.parent_flow_id, kind: r.kind ?? "sdlc",
    createdAt: ts(r.created_at, `flow ${r.id}`), updatedAt: ts(r.updated_at, `flow ${r.id}`),
  })],
  ["branch", "branches", (r) => ({
    id: r.id, flowId: r.flow_id, name: r.name, gitBranch: r.git_branch, title: r.title,
    status: r.status, mrUrl: r.mr_url, mrIid: r.mr_iid, order: r.order,
    createdAt: ts(r.created_at, `branch ${r.id}`), updatedAt: ts(r.updated_at, `branch ${r.id}`),
  })],
  ["node", "nodes", (r) => ({
    id: r.id, flowId: r.flow_id, nodeKey: r.node_key, type: r.type, status: r.status,
    attemptId: r.attempt_id, agentId: r.agent_id, agentRef: r.agent_ref,
    sessionId: r.session_id, label: r.label,
    config: json(r.config, `node ${r.id}.config`),
    joinMode: r.join_mode,
    input: json(r.input, `node ${r.id}.input`),
    output: json(r.output, `node ${r.id}.output`),
    createdAt: ts(r.created_at, `node ${r.id}`), updatedAt: ts(r.updated_at, `node ${r.id}`),
  })],
  ["message", "messages", (r) => ({
    id: r.id, flowId: r.flow_id, nodeKey: r.node_key, thread: r.thread, role: r.role,
    content: r.content, createdAt: ts(r.created_at, `message ${r.id}`),
  })],
  ["event", "events", (r) => ({
    id: r.id, flowId: r.flow_id, nodeId: r.node_id, type: r.type, message: r.message,
    data: json(r.data, `event ${r.id}.data`),
    createdAt: ts(r.created_at, `event ${r.id}`),
  })],
  ["run", "runs", (r) => ({
    id: r.id, flowId: r.flow_id, nodeId: r.node_id, agentRef: r.agent_ref, runRef: r.run_ref,
    branchId: r.branch_id, status: r.status, model: r.model,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens, cacheWriteTokens: r.cache_write_tokens,
    durationMs: r.duration_ms, costCents: r.cost_cents,
    usage: json(r.usage, `run ${r.id}.usage`),
    createdAt: ts(r.created_at, `run ${r.id}`), updatedAt: ts(r.updated_at, `run ${r.id}`),
  })],
  ["artifact", "artifacts", (r) => ({
    id: r.id, nodeId: r.node_id, flowId: r.flow_id, kind: r.kind, version: r.version,
    content: r.content, meta: json(r.meta, `artifact ${r.id}.meta`), status: r.status,
    feedback: r.feedback, createdAt: ts(r.created_at, `artifact ${r.id}`),
  })],
  ["comment", "comments", (r) => ({
    id: r.id, flowId: r.flow_id, mrIid: r.mr_iid, discussionId: r.discussion_id,
    author: r.author, body: r.body, filePath: r.file_path, line: r.line,
    status: r.status, resolvedBy: r.resolved_by, raw: r.raw,
    createdAt: ts(r.created_at, `comment ${r.id}`), updatedAt: ts(r.updated_at, `comment ${r.id}`),
  })],
  ["planStep", "plan_steps", (r) => ({
    id: r.id, flowId: r.flow_id, artifactId: r.artifact_id, metaId: r.meta_id,
    position: r.position, title: r.title, detail: r.detail,
    files: json(r.files, `plan_step ${r.id}.files`), branch: r.branch, status: r.status,
    origin: r.origin, completedBy: r.completed_by, subFlowId: r.sub_flow_id,
    createdAt: ts(r.created_at, `plan_step ${r.id}`), updatedAt: ts(r.updated_at, `plan_step ${r.id}`),
  })],
  ["stepMerge", "step_merges", (r) => ({
    id: r.id, flowId: r.flow_id, parentFlowId: r.parent_flow_id, parentNode: r.parent_node,
    branch: r.branch, status: r.status, attempts: r.attempts, error: r.error,
    createdAt: ts(r.created_at, `step_merge ${r.id}`), updatedAt: ts(r.updated_at, `step_merge ${r.id}`),
  })],
  ["hook", "hooks", (r) => ({
    id: r.id, templateId: r.template_id, flowId: r.flow_id, nodeKey: r.node_key,
    secret: r.secret, filter: r.filter, createdAt: ts(r.created_at, `hook ${r.id}`),
  })],
  ["hookDelivery", "hook_deliveries", (r) => ({
    hookId: r.hook_id, webhookId: r.webhook_id,
    createdAt: ts(r.created_at, `hook_delivery ${r.hook_id}/${r.webhook_id}`),
  })],
  ["worktreeRemoval", "worktree_removals", (r) => ({
    id: r.id, flowId: r.flow_id, repoPath: r.repo_path, path: r.path, branch: r.branch,
    deleteBranch: boolDefault(r.delete_branch, false), reason: r.reason,
    createdAt: ts(r.created_at, `worktree_removal ${r.id}`),
  })],
];

const TARGET_TABLE_NAMES = [
  "step_merges", "plan_steps", "events", "messages", "runs", "artifacts", "comments",
  "branches", "nodes", "hooks", "hook_deliveries", "flows", "flow_template_edges",
  "flow_template_nodes", "node_templates", "flow_templates", "worktree_removals",
  "settings", "gitlab_instances", "jira_instances", "repos", "tasks",
];

const BATCH = 500;

/** Order flows parents-first so the self-FK (parent_flow_id) is satisfied. */
function flowsParentsFirst(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const placed = new Set();
  const out = [];
  let pending = [...rows];
  while (pending.length) {
    const progressed = pending.filter(
      (r) => !r.parent_flow_id || placed.has(r.parent_flow_id) || !byId.has(r.parent_flow_id),
    );
    if (!progressed.length) {
      // cyclic or dangling parents — let Postgres reject it loudly
      out.push(...pending);
      break;
    }
    for (const r of progressed) {
      placed.add(r.id);
      out.push(r);
    }
    pending = pending.filter((r) => !placed.has(r.id));
  }
  return out;
}

async function truncateTarget() {
  const names = TARGET_TABLE_NAMES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  console.log(`truncated ${TARGET_TABLE_NAMES.length} target tables`);
}

async function loadTable(model, table, map) {
  const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
  const ordered = table === "flows" ? flowsParentsFirst(rows) : rows;
  for (let i = 0; i < ordered.length; i += BATCH) {
    const chunk = ordered.slice(i, i + BATCH).map(map);
    await prisma.$transaction(async (tx) => {
      await tx[model].createMany({ data: chunk });
    });
  }
  return rows.length;
}

// ── verification ─────────────────────────────────────────────────────────────

/** Order-insensitive deep JSON equality (JSONB does not preserve key order). */
const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
      : v;
const jsonEq = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

const SAMPLE = 25;

async function spotCheckJsonb() {
  const checks = [
    ["nodes.input", "node", "input"],
    ["nodes.output", "node", "output"],
    ["artifacts.meta", "artifact", "meta"],
  ];
  const results = [];
  for (const [label, model, column] of checks) {
    const source = sqlite
      .prepare(`SELECT id, ${column} AS payload FROM "${model}s" WHERE ${column} IS NOT NULL LIMIT ${SAMPLE}`)
      .all()
      .map((r) => ({ id: r.id, expected: json(r.payload, `${model}s.${column}`) }));
    const target = await prisma[model].findMany({
      where: { id: { in: source.map((s) => s.id) } },
      select: { id: true, [column]: true },
    });
    const byId = new Map(target.map((t) => [t.id, t[column]]));
    let ok = 0;
    const failures = [];
    for (const s of source) {
      if (jsonEq(s.expected, byId.get(s.id))) ok++;
      else failures.push(s.id);
    }
    results.push({ label, compared: source.length, ok, failures });
  }
  return results;
}

async function main() {
  const counts = {};
  await truncateTarget();
  for (const [model, table, map] of TABLES) {
    counts[table] = await loadTable(model, table, map);
    process.stdout.write(`  ${table.padEnd(22)} ${counts[table]} rows\n`);
  }

  console.log("\nverification — row counts (sqlite → postgres):");
  let failed = false;
  const rows = [];
  for (const [, table] of TABLES) {
    const source = counts[table];
    const target = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS c FROM "${table}"`,
    ).then((r) => r[0].c);
    const ok = source === target;
    if (!ok) failed = true;
    rows.push([table, source, target, ok]);
  }

  const jsonbChecks = await spotCheckJsonb();

  const width = Math.max(...rows.map(([t]) => t.length), 14);
  console.log(`  ${"table".padEnd(width)}  sqlite  postgres  jsonb`);
  for (const [table, source, target, ok] of rows) {
    console.log(`  ${table.padEnd(width)}  ${String(source).padStart(6)}  ${String(target).padStart(8)}  ${ok ? "ok" : "MISMATCH"}`);
  }

  console.log("\nverification — JSONB round-trip spot-check (deep JSON equality):");
  for (const { label, compared, failures } of jsonbChecks) {
    const verdict = failures.length === 0 ? "ok" : `MISMATCH (${failures.join(", ")})`;
    console.log(`  ${label.padEnd(16)} ${compared} row(s) compared  ${verdict}`);
    if (failures.length) failed = true;
  }

  if (failed) {
    console.error("\nverification FAILED — see the table above.");
    process.exitCode = 1;
  } else {
    console.log("\nverification passed — migration complete.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    sqlite.close();
    await prisma.$disconnect();
  });
