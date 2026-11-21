import "server-only";

import type { EdgeKind, NodeTemplateKind, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { SDLC_TEMPLATE_ID, NODE_KEYS, STEP_BUILD_TEMPLATE_ID } from "../engine/constants/nodeKeys";

type NodeTemplateSeed = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
};

type StarterNodeSeed = NodeTemplateSeed & {
  readonly kind: NodeTemplateKind;
  readonly config: Prisma.InputJsonValue;
};

type FlowTemplateNodeSeed = {
  readonly nodeKey: string;
  readonly nodeTemplateId: string;
  readonly trigger: Prisma.InputJsonValue;
};

type FlowTemplateEdgeSeed = {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  readonly condition: string | null;
};

type StarterTemplateNodeSeed = {
  readonly key: string;
  readonly nodeTemplateId: string;
  readonly trigger: Prisma.InputJsonValue;
  readonly config: Prisma.InputJsonValue;
  readonly inputMap: Prisma.InputJsonValue;
};

type StarterTemplateEdgeSeed = {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  readonly label: string | null;
};

type StarterTemplateSeed = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly trigger: Prisma.InputJsonValue;
  readonly nodes: readonly StarterTemplateNodeSeed[];
  readonly edges: readonly StarterTemplateEdgeSeed[];
};

/**
 * Idempotent built-in node and flow template seed (the sqlite-era migration
 * user_version 1, now run explicitly — tests call it from
 * `tests/helpers/testDatabase.ts`, the app from the composition root).
 * Runs inside one Prisma transaction.
 *
 * KEEP IN SYNC with `prisma/migrations/20261116100000_builtin_template_seed/`
 * — that migration seeds the same catalog on every `prisma migrate deploy`
 * (dev/prod bootstrap); this class re-seeds truncated test databases.
 *
 * Idempotency contract: every insert targets a deterministic id and never
 * overwrites an existing row — `upsert` with an **empty** `update` (or
 * `createMany({ skipDuplicates: true })`) leaves user-edited rows untouched.
 */
export class TemplateSeeder {
  async seed(tx: PrismaClient | Prisma.TransactionClient): Promise<void> {
    const now = new Date();

    // ── Built-in node templates ─────────────────────────────────────────────
    const builtinNodeTemplates: readonly NodeTemplateSeed[] = [
      // id, key, name, description, icon
      { id: "nt_start", key: NODE_KEYS.START, name: "Start", description: "The template's entry node — carries the branch trigger, then finishes immediately", icon: "Play" },
      { id: "nt_plan", key: NODE_KEYS.PLAN, name: "Plan", description: "Plan the implementation on a planning agent", icon: "Compass" },
      { id: "nt_subflow", key: NODE_KEYS.SUBFLOW, name: "Subflow", description: "Delegate to one child flow from a chosen template — the child's terminal output publishes as this node's aggregate", icon: "GitFork" },
      { id: "nt_build", key: NODE_KEYS.BUILD, name: "Build", description: "Implement the approved plan on an agent", icon: "Hammer" },
      { id: "nt_step_build", key: NODE_KEYS.STEP_BUILD, name: "Step build", description: "One plan step built by its own child flow (plan fan-out) — per-step branch, diff and approval", icon: "Hammer" },
      { id: "nt_pipeline", key: NODE_KEYS.PIPELINE, name: "Pipeline", description: "Wait for a green CI pipeline, fixing failures", icon: "Gauge" },
      { id: "nt_review", key: NODE_KEYS.REVIEW, name: "Review", description: "AI review of the MR diff", icon: "ScanSearch" },
      { id: "nt_resolve", key: NODE_KEYS.RESOLVE, name: "Resolve", description: "Address open MR comments", icon: "CheckCheck" },
    ];
    for (const node of builtinNodeTemplates) {
      await tx.nodeTemplate.upsert({
        where: { id: node.id },
        create: {
          id: node.id,
          key: node.key,
          name: node.name,
          kind: "builtin",
          version: 1,
          description: node.description,
          icon: node.icon,
          config: {},
          isBuiltin: true,
          createdAt: now,
          updatedAt: now,
        },
        // Empty update IS the contract: an existing row (possibly user-edited)
        // is left untouched on every re-seed.
        update: {},
      });
    }

    const sdlcTemplate = await tx.flowTemplate.findUnique({
      where: { id: SDLC_TEMPLATE_ID },
      select: { id: true },
    });
    if (!sdlcTemplate) {
      await tx.flowTemplate.create({
        data: {
          id: SDLC_TEMPLATE_ID,
          name: "SDLC loop",
          description: "The built-in software development loop: plan → build → pipeline → review → resolve.",
          version: 1,
          isBuiltin: true,
          trigger: { type: "manual" },
          createdAt: now,
          updatedAt: now,
        },
      });
      // (node key, trigger) — minutes mirrors the resolve quiet-period default
      const sdlcNodes: readonly FlowTemplateNodeSeed[] = [
        { nodeKey: NODE_KEYS.PLAN, nodeTemplateId: `nt_${NODE_KEYS.PLAN}`, trigger: { type: "manual" } },
        { nodeKey: NODE_KEYS.BUILD, nodeTemplateId: `nt_${NODE_KEYS.BUILD}`, trigger: { type: "approval" } },
        { nodeKey: NODE_KEYS.PIPELINE, nodeTemplateId: `nt_${NODE_KEYS.PIPELINE}`, trigger: { type: "auto", wait_for: "pipeline" } },
        { nodeKey: NODE_KEYS.REVIEW, nodeTemplateId: `nt_${NODE_KEYS.REVIEW}`, trigger: { type: "auto" } },
        { nodeKey: NODE_KEYS.RESOLVE, nodeTemplateId: `nt_${NODE_KEYS.RESOLVE}`, trigger: { type: "debounced", minutes: 10, wait_for: "comments" } },
      ];
      await tx.flowTemplateNode.createMany({
        data: sdlcNodes.map((node) => ({
          id: `ftn_${node.nodeKey}`,
          templateId: SDLC_TEMPLATE_ID,
          nodeKey: node.nodeKey,
          nodeTemplateId: node.nodeTemplateId,
          label: null,
          trigger: node.trigger,
          joinMode: "all",
          config: {},
          inputMap: {},
          createdAt: now,
          updatedAt: now,
        })),
      });
      // (from, to, kind, condition) — the loop is template data now: resolve
      // re-enters the CI gate only when the resolve agent actually pushed code
      // (JSONata over the resolve output contract); a no-code fix ends the
      // cycle. Condition-less loop edges stay display metadata.
      const sdlcEdges: readonly FlowTemplateEdgeSeed[] = [
        { from: NODE_KEYS.PLAN, to: NODE_KEYS.BUILD, kind: "next", condition: null },
        { from: NODE_KEYS.BUILD, to: NODE_KEYS.PIPELINE, kind: "next", condition: null },
        { from: NODE_KEYS.PIPELINE, to: NODE_KEYS.REVIEW, kind: "next", condition: null },
        { from: NODE_KEYS.REVIEW, to: NODE_KEYS.RESOLVE, kind: "next", condition: null },
        { from: NODE_KEYS.RESOLVE, to: NODE_KEYS.PIPELINE, kind: "loop", condition: "nodes.resolve.output.pushed = true" },
      ];
      await tx.flowTemplateEdge.createMany({
        data: sdlcEdges.map((edge) => ({
          id: `fte_${edge.from}_${edge.to}`,
          templateId: SDLC_TEMPLATE_ID,
          fromKey: edge.from,
          toKey: edge.to,
          kind: edge.kind,
          label: null,
          condition: edge.condition,
          createdAt: now,
          updatedAt: now,
        })),
        // Matches the raw `ON CONFLICT DO NOTHING` (no target): skips on any
        // unique violation — the `id` PK and the
        // (template_id, from_key, to_key, label) unique both exist in the schema.
        skipDuplicates: true,
      });
    } else {
      // migrate older seedings: the display-only `resolve → review` loop edge
      // becomes the real re-entry `resolve → pipeline` edge (conditioned on
      // the resolve output contract). Idempotent: deterministic edge ids, and
      // existing running flows keep their snapshotted graph semantics.
      await tx.flowTemplateEdge.deleteMany({
        where: {
          id: `fte_${NODE_KEYS.RESOLVE}_${NODE_KEYS.REVIEW}`,
          templateId: SDLC_TEMPLATE_ID,
          fromKey: NODE_KEYS.RESOLVE,
          kind: "loop",
        },
      });
      await tx.flowTemplateEdge.createMany({
        // Single-row `ON CONFLICT DO NOTHING` (no target) equivalent:
        // `skipDuplicates` skips on any unique violation, exactly like the raw
        // statement did (an `upsert` keyed only on `id` would instead throw on
        // a composite-unique conflict).
        data: [{
          id: `fte_${NODE_KEYS.RESOLVE}_${NODE_KEYS.PIPELINE}`,
          templateId: SDLC_TEMPLATE_ID,
          fromKey: NODE_KEYS.RESOLVE,
          toKey: NODE_KEYS.PIPELINE,
          kind: "loop",
          label: null,
          condition: "nodes.resolve.output.pushed = true",
          createdAt: now,
          updatedAt: now,
        }],
        skipDuplicates: true,
      });
    }

    // ── Plan fan-out: the built-in step template ────────────────────────────
    // The child template a fan-out `build` node defaults to (`child` unset).
    // `hidden` keeps it out of the gallery (it is a child template; the fan-out
    // knob references it by id, never the picker).
    const stepBuildTemplate = await tx.flowTemplate.findUnique({
      where: { id: STEP_BUILD_TEMPLATE_ID },
      select: { id: true },
    });
    if (!stepBuildTemplate) {
      await tx.flowTemplate.create({
        data: {
          id: STEP_BUILD_TEMPLATE_ID,
          name: "Step build",
          description: "One plan step built by its own child flow — per-step branch, diff and approval gate (fan-out child of the build node).",
          version: 1,
          isBuiltin: true,
          trigger: { type: "manual" },
          hidden: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.flowTemplateNode.create({
        data: {
          id: "ftn_tpl_step_build_step_build",
          templateId: STEP_BUILD_TEMPLATE_ID,
          nodeKey: NODE_KEYS.STEP_BUILD,
          nodeTemplateId: "nt_step_build",
          label: null,
          trigger: { type: "approval" },
          joinMode: "all",
          config: {},
          inputMap: {},
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    // ── Starter templates ───────────────────────────────────────────────────
    // Declarative catalog rows the starters reference (is_builtin=false — the
    // user may edit/duplicate them like any authored node), then three built-in
    // flow templates exercising agent / decision / http / script + input maps.
    // Idempotent: deterministic ids + skipDuplicates/upsert-with-empty-update;
    // configs mirror the docs/flow-templates/*.yaml fixtures so export/import
    // round-trips.
    const starterNodeTemplates: readonly StarterNodeSeed[] = [
      {
        id: "nt_st_summarize", key: "docs_summary", kind: "agent", name: "Docs summarize", icon: "agent",
        description: "Plan-mode agent that summarizes shipped work into markdown",
        config: {
          mode: "plan", output: "markdown",
          prompt: "Summarize the shipped work on task {{task.key}} — {{task.summary}}.\n"
            + "Read the repo at {{repo.local_path}} and cover: user-facing changes,\n"
            + "configuration surface, and gotchas. Write it as markdown.",
        },
      },
      {
        id: "nt_st_write_doc", key: "docs_write", kind: "script", name: "Docs write", icon: "Terminal",
        description: "Shell script that saves the mapped `doc` field into the repo's docs/",
        config: {
          runtime: "shell",
          script: "cat > docs/devflow-summary.md\nprintf '{\"written\":true}' > \"$DEVFLOW_OUTPUT\"",
          cwd: "repo",
          output_schema: {
            type: "object",
            required: ["written"],
            properties: { written: { type: "boolean" } },
          },
        },
      },
      {
        id: "nt_st_release_notes", key: "release_notes", kind: "agent", name: "Release notes draft", icon: "agent",
        description: "Plan-mode agent that drafts release notes from the task",
        config: {
          mode: "plan", output: "markdown",
          prompt: "Draft release notes for task {{task.key}} ({{task.summary}}).\n"
            + "Lead with user impact, then notable behavior changes and migrations. Under 200 words.",
        },
      },
      {
        id: "nt_st_ship_decision", key: "ship_decision", kind: "decision", name: "Ship decision", icon: "Split",
        description: "Manual choice: send the draft out or drop it",
        config: {
          source: "manual",
          choices: [
            { label: "send", description: "Good enough — notify the webhook" },
            { label: "drop", description: "Not ready — skip the notify" },
          ],
        },
      },
      {
        id: "nt_st_notify", key: "notify_slack", kind: "http", name: "Notify webhook", icon: "Send",
        description: "Outbound HTTP notification ({{secrets.SLACK_WEBHOOK}} resolves at run time)",
        config: {
          url: "{{secrets.SLACK_WEBHOOK}}",
          method: "POST",
          body: "Release notes:\n\n{{nodes.release_notes.output.markdown}}",
        },
      },
      {
        id: "nt_st_triage", key: "triage_agent", kind: "agent", name: "Sentry triage", icon: "agent",
        description: "Plan-mode agent that triages a Sentry issue into structured JSON",
        config: {
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
        },
      },
      {
        id: "nt_st_worth_fixing", key: "worth_fixing", kind: "decision", name: "Worth fixing?", icon: "Split",
        description: "Agent proposes; with trigger: approval the user disposes (§4.3)",
        config: {
          source: "agent",
          question: "Given the triage result, is this issue worth an automated fix PR?",
          choices: [
            { label: "fix", description: "Real user-facing bug with a plausible localized fix" },
            { label: "ignore", description: "Noise, duplicate, or too risky to auto-fix" },
          ],
        },
      },
      {
        id: "nt_st_open_pr", key: "open_pr", kind: "agent", name: "Open fix PR", icon: "Bot",
        description: "Agent-mode run with repo access that fixes the triaged issue",
        config: {
          mode: "agent",
          prompt: "Fix the issue: {{nodes.triage.output.suggested_fix}} — issue {{task.key}}.",
        },
      },
      {
        id: "nt_st_triage_notify", key: "triage_notify", kind: "http", name: "Notify webhook", icon: "Send",
        description: "Outbound notification with the triage summary (secrets resolve at run time)",
        config: {
          url: "{{secrets.SLACK_WEBHOOK}}",
          method: "POST",
          body: "{ \"text\": \"Triaged {{task.key}}: {{nodes.triage.output.summary}}\" }",
        },
      },
    ];
    for (const node of starterNodeTemplates) {
      await tx.nodeTemplate.upsert({
        where: { id: node.id },
        create: {
          id: node.id,
          key: node.key,
          name: node.name,
          kind: node.kind,
          version: 1,
          description: node.description,
          icon: node.icon,
          config: node.config,
          isBuiltin: false,
          createdAt: now,
          updatedAt: now,
        },
        // Empty update IS the contract: an existing row (possibly user-edited)
        // is left untouched on every re-seed.
        update: {},
      });
    }

    const starterTemplates: readonly StarterTemplateSeed[] = [
      {
        id: "tpl_docs_generation",
        name: "Docs generation",
        description: "Summarize shipped work on a task into a docs page in the repo — starter: agent → script with input mapping.",
        trigger: { type: "manual" },
        nodes: [
          { key: "summarize", nodeTemplateId: "nt_st_summarize", trigger: { type: "auto" }, config: {}, inputMap: {} },
          { key: "write_doc", nodeTemplateId: "nt_st_write_doc", trigger: { type: "auto" }, config: {}, inputMap: { doc: "nodes.summarize.output.markdown" } },
        ],
        edges: [
          { from: "summarize", to: "write_doc", kind: "next", label: null },
        ],
      },
      {
        id: "tpl_release_notify",
        name: "Release notes + notify",
        description: "Draft release notes from a task, decide whether to ship them, and notify a webhook — starter: agent → decision (manual) → http.",
        trigger: { type: "manual" },
        nodes: [
          { key: "release_notes", nodeTemplateId: "nt_st_release_notes", trigger: { type: "auto" }, config: {}, inputMap: {} },
          { key: "ship_decision", nodeTemplateId: "nt_st_ship_decision", trigger: { type: "auto" }, config: {}, inputMap: {} },
          { key: "notify", nodeTemplateId: "nt_st_notify", trigger: { type: "auto" }, config: {}, inputMap: {} },
        ],
        edges: [
          { from: "release_notes", to: "ship_decision", kind: "next", label: null },
          { from: "ship_decision", to: "notify", kind: "next", label: "send" },
        ],
      },
      {
        id: "tpl_sentry_triage",
        name: "Sentry triage",
        description: "Inbound-webhook triage: agent triages a Sentry issue, an agent-proposes / approval-disposes decision branches fix/ignore, Slack gets notified. Duplicate to bind a task type + repo.",
        trigger: { type: "webhook", filter: "payload.event = 'issue.created'" },
        nodes: [
          {
            key: "triage", nodeTemplateId: "nt_st_triage", trigger: { type: "auto" }, config: {},
            inputMap: { summary: "trigger.payload.issue.title", stack: "trigger.payload.issue.stacktrace" },
          },
          { key: "worth_fixing", nodeTemplateId: "nt_st_worth_fixing", trigger: { type: "approval" }, config: {}, inputMap: {} },
          { key: "open_pr", nodeTemplateId: "nt_st_open_pr", trigger: { type: "auto" }, config: {}, inputMap: {} },
          { key: "notify", nodeTemplateId: "nt_st_triage_notify", trigger: { type: "auto" }, config: {}, inputMap: {} },
        ],
        edges: [
          { from: "triage", to: "worth_fixing", kind: "next", label: null },
          { from: "worth_fixing", to: "open_pr", kind: "next", label: "fix" },
          { from: "triage", to: "notify", kind: "next", label: null },
        ],
      },
    ];
    for (const template of starterTemplates) {
      const existing = await tx.flowTemplate.findUnique({
        where: { id: template.id },
        select: { id: true },
      });
      if (existing) continue;
      await tx.flowTemplate.create({
        data: {
          id: template.id,
          name: template.name,
          description: template.description,
          version: 1,
          isBuiltin: true,
          trigger: template.trigger,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.flowTemplateNode.createMany({
        data: template.nodes.map((node) => ({
          id: `ftn_${template.id.slice(4)}_${node.key}`,
          templateId: template.id,
          nodeKey: node.key,
          nodeTemplateId: node.nodeTemplateId,
          label: null,
          trigger: node.trigger,
          joinMode: "all",
          config: node.config,
          inputMap: node.inputMap,
          x: null,
          y: null,
          createdAt: now,
          updatedAt: now,
        })),
      });
      await tx.flowTemplateEdge.createMany({
        data: template.edges.map((edge) => ({
          id: `fte_${template.id.slice(4)}_${edge.from}_${edge.to}${edge.label ? `_${edge.label}` : ""}`,
          templateId: template.id,
          fromKey: edge.from,
          toKey: edge.to,
          kind: edge.kind,
          label: edge.label,
          condition: null,
          createdAt: now,
          updatedAt: now,
        })),
        // Same `ON CONFLICT DO NOTHING` (no target) semantics as the raw
        // statement — see the SDLC edges block above for the constraint note.
        skipDuplicates: true,
      });
    }
  }
}

/** Type-only re-export so callers can type the executor without importing Prisma. */
export type TemplateSeedExecutor = PrismaClient | Prisma.TransactionClient;
