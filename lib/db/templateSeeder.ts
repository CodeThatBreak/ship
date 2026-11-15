import "server-only";

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { SDLC_TEMPLATE_ID, NODE_KEYS, STEP_BUILD_TEMPLATE_ID } from "../engine/constants/nodeKeys";

/**
 * Idempotent built-in node and flow template seed (the sqlite-era migration
 * user_version 1, now run explicitly — tests call it from
 * `tests/helpers/testDatabase.ts`, the app from the composition root).
 * Runs inside one Prisma transaction.
 */
export class TemplateSeeder {
  async seed(tx: PrismaClient | Prisma.TransactionClient): Promise<void> {
    const now = new Date();

    const nt: [string, string, string, string, string][] = [
      // id, key, name, description, icon
      ["nt_start", "start", "Start", "The template's entry node — carries the branch trigger, then finishes immediately", "Play"],
      ["nt_plan", "plan", "Plan", "Plan the implementation on a planning agent", "Compass"],
      ["nt_build", "build", "Build", "Implement the approved plan on an agent", "Hammer"],
      ["nt_step_build", "step_build", "Step build", "One plan step built by its own child flow (plan fan-out) — per-step branch, diff and approval", "Hammer"],
      ["nt_pipeline", "pipeline", "Pipeline", "Wait for a green CI pipeline, fixing failures", "Gauge"],
      ["nt_review", "review", "Review", "AI review of the MR diff", "ScanSearch"],
      ["nt_resolve", "resolve", "Resolve", "Address open MR comments", "CheckCheck"],
    ];
    for (const [id, key, name, description, icon] of nt) {
      await tx.$executeRaw`
        INSERT INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
        VALUES (${id},${key},${name},'builtin',1,${description},${icon},'{}'::jsonb,true,${now},${now})
        ON CONFLICT (id) DO NOTHING`;
    }
    const hasSdlc = await tx.$queryRaw<{ "?column?": number }[]>`
      SELECT 1 FROM flow_templates WHERE id=${SDLC_TEMPLATE_ID}`;
    if (hasSdlc.length === 0) {
      await tx.$executeRaw`
        INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,created_at,updated_at)
        VALUES (${SDLC_TEMPLATE_ID},'SDLC loop',${"The built-in software development loop: plan → build → pipeline → review → resolve."},1,true,'{"type":"manual"}'::jsonb,${now},${now})`;
      // (key, trigger JSON) — minutes mirrors the resolve quiet-period default
      const nodes: [string, string][] = [
        [NODE_KEYS.PLAN, '{"type":"manual"}'],
        [NODE_KEYS.BUILD, '{"type":"approval"}'],
        [NODE_KEYS.PIPELINE, '{"type":"auto","wait_for":"pipeline"}'],
        [NODE_KEYS.REVIEW, '{"type":"auto"}'],
        [NODE_KEYS.RESOLVE, '{"type":"debounced","minutes":10,"wait_for":"comments"}'],
      ];
      for (const [key, trigger] of nodes) {
        const id = `ftn_${key}`;
        const nodeTemplateId = `nt_${key}`;
        await tx.$executeRaw`
          INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,created_at,updated_at)
          VALUES (${id},${SDLC_TEMPLATE_ID},${key},${nodeTemplateId},NULL,${trigger}::jsonb,'all','{}'::jsonb,'{}'::jsonb,${now},${now})`;
      }
      // (from, to, kind, condition) — the loop is template data now: resolve
      // re-enters the CI gate only when the resolve agent actually pushed code
      // (JSONata over the resolve output contract); a no-code fix ends the
      // cycle. Condition-less loop edges stay display metadata.
      const edges: [string, string, string, string | null][] = [
        [NODE_KEYS.PLAN, NODE_KEYS.BUILD, "next", null],
        [NODE_KEYS.BUILD, NODE_KEYS.PIPELINE, "next", null],
        [NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW, "next", null],
        [NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE, "next", null],
        [NODE_KEYS.RESOLVE, NODE_KEYS.PIPELINE, "loop", "nodes.resolve.output.pushed = true"],
      ];
      for (const [from, to, kind, condition] of edges) {
        await tx.$executeRaw`
          INSERT INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
          VALUES (${`fte_${from}_${to}`},${SDLC_TEMPLATE_ID},${from},${to},${kind},NULL,${condition},${now},${now})
          ON CONFLICT DO NOTHING`;
      }
    } else {
      // migrate older seedings: the display-only `resolve → review` loop edge
      // becomes the real re-entry `resolve → pipeline` edge (conditioned on
      // the resolve output contract). Idempotent: deterministic edge ids, and
      // existing running flows keep their snapshotted graph semantics.
      await tx.$executeRaw`
        DELETE FROM flow_template_edges
        WHERE template_id=${SDLC_TEMPLATE_ID} AND id='fte_resolve_review'
          AND from_key=${NODE_KEYS.RESOLVE} AND kind='loop'`;
      await tx.$executeRaw`
        INSERT INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
        VALUES ('fte_resolve_pipeline',${SDLC_TEMPLATE_ID},${NODE_KEYS.RESOLVE},${NODE_KEYS.PIPELINE},'loop',NULL,${"nodes.resolve.output.pushed = true"},${now},${now})
        ON CONFLICT DO NOTHING`;
    }

    // ── Plan fan-out: the built-in step template ────────────────────────────
    // The child template a fan-out `build` node defaults to (`child` unset).
    // `hidden` keeps it out of the gallery (it is a child template; the fan-out
    // knob references it by id, never the picker).
    const hasStepBuild = await tx.$queryRaw<{ "?column?": number }[]>`
      SELECT 1 FROM flow_templates WHERE id=${STEP_BUILD_TEMPLATE_ID}`;
    if (hasStepBuild.length === 0) {
      await tx.$executeRaw`
        INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,hidden,created_at,updated_at)
        VALUES (${STEP_BUILD_TEMPLATE_ID},'Step build',${"One plan step built by its own child flow — per-step branch, diff and approval gate (fan-out child of the build node)."},1,true,'{"type":"manual"}'::jsonb,true,${now},${now})`;
      await tx.$executeRaw`
        INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,created_at,updated_at)
        VALUES ('ftn_tpl_step_build_step_build',${STEP_BUILD_TEMPLATE_ID},${NODE_KEYS.STEP_BUILD},'nt_step_build',NULL,'{"type":"approval"}'::jsonb,'all','{}'::jsonb,'{}'::jsonb,${now},${now})`;
    }

    // ── Starter templates ───────────────────────────────────────────────────
    // Declarative catalog rows the starters reference (is_builtin=false — the
    // user may edit/duplicate them like any authored node), then three built-in
    // flow templates exercising agent / decision / http / script + input maps.
    // Idempotent: deterministic ids + ON CONFLICT DO NOTHING; configs mirror
    // the docs/flow-templates/*.yaml fixtures so export/import round-trips.
    const starterNodes: [string, string, string, string, string, string, string][] = [
      // id, key, kind, name, icon, description, config JSON
      ["nt_st_summarize", "docs_summary", "agent", "Docs summarize", "agent",
        "Plan-mode agent that summarizes shipped work into markdown",
        JSON.stringify({
          mode: "plan", output: "markdown",
          prompt: "Summarize the shipped work on task {{task.key}} — {{task.summary}}.\n"
            + "Read the repo at {{repo.local_path}} and cover: user-facing changes,\n"
            + "configuration surface, and gotchas. Write it as markdown.",
        })],
      ["nt_st_write_doc", "docs_write", "script", "Docs write", "Terminal",
        "Shell script that saves the mapped `doc` field into the repo's docs/",
        JSON.stringify({
          runtime: "shell",
          script: "cat > docs/devflow-summary.md\necho '{\"written\": true}'",
          cwd: "repo",
        })],
      ["nt_st_release_notes", "release_notes", "agent", "Release notes draft", "agent",
        "Plan-mode agent that drafts release notes from the task",
        JSON.stringify({
          mode: "plan", output: "markdown",
          prompt: "Draft release notes for task {{task.key}} ({{task.summary}}).\n"
            + "Lead with user impact, then notable behavior changes and migrations. Under 200 words.",
        })],
      ["nt_st_ship_decision", "ship_decision", "decision", "Ship decision", "Split",
        "Manual choice: send the draft out or drop it",
        JSON.stringify({
          source: "manual",
          choices: [
            { label: "send", description: "Good enough — notify the webhook" },
            { label: "drop", description: "Not ready — skip the notify" },
          ],
        })],
      ["nt_st_notify", "notify_slack", "http", "Notify webhook", "Send",
        "Outbound HTTP notification ({{secrets.SLACK_WEBHOOK}} resolves at run time)",
        JSON.stringify({
          url: "{{secrets.SLACK_WEBHOOK}}",
          method: "POST",
          body: "Release notes:\n\n{{nodes.release_notes.output.markdown}}",
        })],
      ["nt_st_triage", "triage_agent", "agent", "Sentry triage", "agent",
        "Plan-mode agent that triages a Sentry issue into structured JSON",
        JSON.stringify({
          mode: "plan", output: "json",
          prompt: "Triage this Sentry issue: {{trigger.payload.issue.title}}\n\nStacktrace:\n{{trigger.payload.issue.stacktrace}}\n"
            + "Task context: {{task.key}} — {{task.summary}}\n\n"
            + "Scan the codebase for the likely cause, then output JSON: {severity, summary, suggested_fix}.",
          output_schema: {
            type: "object",
            required: ["severity", "summary"],
            properties: {
              severity: { type: "string", enum: ["low", "med", "high"] },
              summary: { type: "string" },
              suggested_fix: { type: "string" },
            },
          },
        })],
      ["nt_st_worth_fixing", "worth_fixing", "decision", "Worth fixing?", "Split",
        "Agent proposes; with trigger: approval the user disposes (§4.3)",
        JSON.stringify({
          source: "agent",
          question: "Given the triage result, is this issue worth an automated fix PR?",
          choices: [
            { label: "fix", description: "Real user-facing bug with a plausible localized fix" },
            { label: "ignore", description: "Noise, duplicate, or too risky to auto-fix" },
          ],
        })],
      ["nt_st_open_pr", "open_pr", "agent", "Open fix PR", "Bot",
        "Agent-mode run with repo access that fixes the triaged issue",
        JSON.stringify({
          mode: "agent",
          prompt: "Fix the issue: {{nodes.triage.output.suggested_fix}} — issue {{task.key}}.",
        })],
      ["nt_st_triage_notify", "triage_notify", "http", "Notify webhook", "Send",
        "Outbound notification with the triage summary (secrets resolve at run time)",
        JSON.stringify({
          url: "{{secrets.SLACK_WEBHOOK}}",
          method: "POST",
          body: "{ \"text\": \"Triaged {{task.key}}: {{nodes.triage.output.summary}}\" }",
        })],
    ];
    for (const [id, key, kind, name, icon, description, config] of starterNodes) {
      await tx.$executeRaw`
        INSERT INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
        VALUES (${id},${key},${name},${kind},1,${description},${icon},${config}::jsonb,false,${now},${now})
        ON CONFLICT (id) DO NOTHING`;
    }

    const starterTemplates: {
      id: string; name: string; description: string; trigger: string;
      nodes: [string, string, string, string | null, string | null][]; // key, nodeTemplateId, trigger, config, inputMap
      edges: [string, string, string, string | null][]; // from, to, kind, label
    }[] = [
      {
        id: "tpl_docs_generation",
        name: "Docs generation",
        description: "Summarize shipped work on a task into a docs page in the repo — starter: agent → script with input mapping.",
        trigger: '{"type":"manual"}',
        nodes: [
          ["summarize", "nt_st_summarize", '{"type":"auto"}', null, null],
          ["write_doc", "nt_st_write_doc", '{"type":"auto"}', null, '{"doc":"nodes.summarize.output.markdown"}'],
        ],
        edges: [["summarize", "write_doc", "next", null]],
      },
      {
        id: "tpl_release_notify",
        name: "Release notes + notify",
        description: "Draft release notes from a task, decide whether to ship them, and notify a webhook — starter: agent → decision (manual) → http.",
        trigger: '{"type":"manual"}',
        nodes: [
          ["release_notes", "nt_st_release_notes", '{"type":"auto"}', null, null],
          ["ship_decision", "nt_st_ship_decision", '{"type":"auto"}', null, null],
          ["notify", "nt_st_notify", '{"type":"auto"}', null, null],
        ],
        edges: [
          ["release_notes", "ship_decision", "next", null],
          ["ship_decision", "notify", "next", "send"],
        ],
      },
      {
        id: "tpl_sentry_triage",
        name: "Sentry triage",
        description: "Inbound-webhook triage: agent triages a Sentry issue, an agent-proposes / approval-disposes decision branches fix/ignore, Slack gets notified. Duplicate to bind a task type + repo.",
        trigger: '{"type":"webhook","filter":"payload.event = \'issue.created\'"}',
        nodes: [
          ["triage", "nt_st_triage", '{"type":"auto"}', null,
            '{"summary":"trigger.payload.issue.title","stack":"trigger.payload.issue.stacktrace"}'],
          ["worth_fixing", "nt_st_worth_fixing", '{"type":"approval"}', null, null],
          ["open_pr", "nt_st_open_pr", '{"type":"auto"}', null, null],
          ["notify", "nt_st_triage_notify", '{"type":"auto"}', null, null],
        ],
        edges: [
          ["triage", "worth_fixing", "next", null],
          ["worth_fixing", "open_pr", "next", "fix"],
          ["triage", "notify", "next", null],
        ],
      },
    ];
    for (const st of starterTemplates) {
      const exists = await tx.$queryRaw<{ "?column?": number }[]>`
        SELECT 1 FROM flow_templates WHERE id=${st.id}`;
      if (exists.length > 0) continue;
      await tx.$executeRaw`
        INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,created_at,updated_at)
        VALUES (${st.id},${st.name},${st.description},1,true,${st.trigger}::jsonb,${now},${now})`;
      for (const [key, nodeTemplateId, trigger, config, inputMap] of st.nodes) {
        await tx.$executeRaw`
          INSERT INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,x,y,created_at,updated_at)
          VALUES (${`ftn_${st.id.slice(4)}_${key}`},${st.id},${key},${nodeTemplateId},NULL,${trigger}::jsonb,'all',${config ?? "{}"}::jsonb,${inputMap ?? "{}"}::jsonb,NULL,NULL,${now},${now})`;
      }
      for (const [from, to, kind, label] of st.edges) {
        await tx.$executeRaw`
          INSERT INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
          VALUES (${`fte_${st.id.slice(4)}_${from}_${to}${label ? `_${label}` : ""}`},${st.id},${from},${to},${kind},${label},NULL,${now},${now})
          ON CONFLICT DO NOTHING`;
      }
    }
  }
}

/** Type-only re-export so callers can type the executor without importing Prisma. */
export type TemplateSeedExecutor = PrismaClient | Prisma.TransactionClient;
