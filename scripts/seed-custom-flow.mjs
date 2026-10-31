/**
 * Seed a demo flow for a CUSTOM template (Phase 5 §10B): instantiates the
 * seeded "Release notes + notify" starter and fast-forwards it so the graph,
 * the decision card, and the skipped branch tell the story on open — all
 * without any agent runs or external calls.
 *
 * Usage:
 *   node scripts/seed-custom-flow.mjs           # seed (idempotent: resets + recreates)
 *   node scripts/seed-custom-flow.mjs --reset   # remove the demo flows + task only
 *
 * What you get (open http://localhost:3000 → the custom demo flows on DEMO-201):
 *   - flow #1: release_notes done (markdown artifact) → ship_decision chose
 *     "send" (decision card shows the pick) → notify done → the taken edge
 *     highlights in the graph
 *   - flow #2: same template, ship_decision chose "drop" → notify ends at
 *     skipped (branch deactivated, skipped propagation visible)
 *
 * Requires the starter templates to exist — open the app once first (they seed
 * at migration time), or `npm run seed:demo` for the built-in loop demo.
 */
import path from "path";
import { fileURLToPath } from "url";
import {
  deleteFlowCascade,
  minsAgo,
  now,
  openSeedDb,
  uid,
} from "./lib/seed-db.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE_ID = "tpl_release_notify";
const FLOW_NAME_DONE = "DEMO custom: release notes shipped";
const FLOW_NAME_SKIP = "DEMO custom: notes dropped";
const TASK_ID = "demo-201";
const RESET = process.argv.includes("--reset");

const { db } = openSeedDb(root);

const NOTES = `# Release notes — DEMO-201 webhook delivery retries

## Highlights
- Outbound webhook deliveries are now retried with exponential backoff and jitter
  (1min → 5min → 30min → 2h → 6h, 5 attempts, then dead-letter).
- Every event persists to a durable outbox first, so a worker crash loses nothing.
- New admin endpoint \`POST /admin/webhooks/:id/replay\` revives dead events.

## Upgrading
No config changes required; delivery status is visible per event in the admin table.`;

const template = db.prepare(`SELECT id FROM flow_templates WHERE id=?`).get(TEMPLATE_ID);
if (!template) {
  console.error(`starter template "${TEMPLATE_ID}" not found — open the app once (npm run dev) so migrations seed the starters`);
  process.exit(1);
}

function flowRowByName(name) {
  return db.prepare(`SELECT id FROM flows WHERE name=?`).get(name);
}

function reset() {
  const ids = new Set();
  for (const row of [
    flowRowByName(FLOW_NAME_DONE),
    flowRowByName(FLOW_NAME_SKIP),
    ...db.prepare(`SELECT id FROM flows WHERE task_id=?`).all(TASK_ID),
  ]) {
    if (row?.id) ids.add(row.id);
  }
  for (const id of ids) {
    deleteFlowCascade(db, id);
    console.log(`removed demo flow ${id}`);
  }
  db.prepare(`DELETE FROM tasks WHERE id=?`).run(TASK_ID);
}

if (RESET) {
  reset();
  console.log("custom demo reset done");
  process.exit(0);
}

reset();

// ── task ───────────────────────────────────────────────────────────────────
const repo = db.prepare(`SELECT id, cloud_url FROM repos ORDER BY created_at LIMIT 1`).get();
db.prepare(`INSERT INTO tasks (id,key,type,summary,description,status,issue_type,priority,repo_url,external_url,raw,fields,synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(TASK_ID, "DEMO-201", "jira", "Custom-flow demo — webhook retry release notes",
    "Demo task for the custom-flow seed: release notes drafted, decided, notified.",
    "Done", "Story", "Medium",
    repo?.cloud_url ?? null, "https://jira.example.com/browse/DEMO-201", JSON.stringify({ demo: true }),
    JSON.stringify({ prd: "See the release notes artifacts on the demo flows.", figma_urls: [] }), now());
console.log("task DEMO-201 inserted");

// ── flow factory (mirrors FlowEngine.create()'s node snapshot; flows.status
//    'done' — the demo flow is complete, so nothing blocks template edits) ────
function makeFlow(name, min) {
  const flowId = uid("flow_");
  const ts = minsAgo(min);
  db.prepare(`INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(flowId, TASK_ID, name, "done",
      repo?.cloud_url ?? "https://gitlab.example.com/acme/webapp", repo?.id ?? null, "cloud",
      TEMPLATE_ID, JSON.stringify({}), ts, ts);
  const nodeIds = {};
  // type mirrors FlowEngine.create(): the node_templates row id backing the
  // instance (declarative kinds resolve the runtime def by that id)
  const typeOf = {
    release_notes: "nt_st_release_notes",
    ship_decision: "nt_st_ship_decision",
    notify: "nt_st_notify",
  };
  for (const key of ["release_notes", "ship_decision", "notify"]) {
    const nid = uid("node_");
    nodeIds[key] = nid;
    const type = db.prepare(`SELECT id FROM node_templates WHERE id=?`).get(typeOf[key])?.id ?? key;
    db.prepare(`INSERT INTO nodes (id,flow_id,node_key,type,label,config,join_mode,status,created_at,updated_at)
      VALUES (?,?,?,?,NULL,'{}','all','pending',?,?)`)
      .run(nid, flowId, key, type, ts, ts);
  }
  return { flowId, nodeIds };
}

const ev = (flowId, msg, m, nodeId = null) => {
  db.prepare(`INSERT INTO events (id,flow_id,node_id,type,message,created_at) VALUES (?,?,?,'lifecycle',?,?)`)
    .run(uid("ev_"), flowId, nodeId, msg, minsAgo(m));
};

// ── act 1: notes shipped — every node done, the notify branch taken ──────────
const { flowId: f1, nodeIds: n1 } = makeFlow(FLOW_NAME_DONE, 58);

const art1 = uid("art_");
db.prepare(`INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,feedback,created_at)
  VALUES (?,?,?,?,1,?,NULL,'draft',NULL,?)`)
  .run(art1, n1.release_notes, f1, "markdown", NOTES, minsAgo(48));
db.prepare(`UPDATE nodes SET status='done', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ markdown: NOTES }), minsAgo(47), n1.release_notes);
ev(f1, "release notes drafted (agent node, markdown artifact)", 48, n1.release_notes);

db.prepare(`UPDATE nodes SET status='done', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ chosen: ["send"], rationale: "manual pick: good enough to notify" }), minsAgo(40), n1.ship_decision);
ev(f1, "decision 'ship_decision': send — notify branch taken", 40, n1.ship_decision);

db.prepare(`UPDATE nodes SET status='done', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ status: 200, ok: true }), minsAgo(38), n1.notify);
ev(f1, "notify delivered (http node) — 200", 38, n1.notify);
ev(f1, "flow complete", 38);

console.log(`flow #1 created: ${f1} → decision chose send`);

// ── act 2: notes dropped — the notify branch resolves inactive → skipped ─────
const { flowId: f2, nodeIds: n2 } = makeFlow(FLOW_NAME_SKIP, 30);

const art2 = uid("art_");
db.prepare(`INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,feedback,created_at)
  VALUES (?,?,?,?,1,?,NULL,'draft',NULL,?)`)
  .run(art2, n2.release_notes, f2, "markdown", NOTES, minsAgo(24));
db.prepare(`UPDATE nodes SET status='done', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ markdown: NOTES }), minsAgo(23), n2.release_notes);
ev(f2, "release notes drafted (agent node, markdown artifact)", 24, n2.release_notes);

db.prepare(`UPDATE nodes SET status='done', output=?, updated_at=? WHERE id=?`)
  .run(JSON.stringify({ chosen: ["drop"], rationale: "manual pick: not ready to send" }), minsAgo(18), n2.ship_decision);
db.prepare(`UPDATE nodes SET status='skipped', updated_at=? WHERE id=?`).run(minsAgo(18), n2.notify);
ev(f2, "decision 'ship_decision': drop — notify skipped", 18, n2.ship_decision);
ev(f2, "flow complete", 18);

console.log(`flow #2 created: ${f2} → decision chose drop, notify skipped`);

console.log(`\nopen http://localhost:3000/flows/${f1} and /flows/${f2}`);
