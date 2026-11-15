-- Builtin node + flow template seed (the Postgres successor of sqlite-era
-- migration user_version 1). Idempotent: deterministic ids + ON CONFLICT DO
-- NOTHING, so `prisma migrate deploy` is safe on any database state.
-- KEEP IN SYNC with lib/db/templateSeeder.ts (the test-reset path re-runs the
-- same catalog in TypeScript — tests truncate all tables between files).

-- ── builtin node templates (the engine's seven node kinds) ──────────────────
INSERT INTO node_templates (id, key, name, kind, version, description, icon, config, is_builtin, created_at, updated_at) VALUES
  ('nt_start',    'start',    'Start',      'builtin', 1, 'The template''s entry node — carries the branch trigger, then finishes immediately', 'Play',      '{}', true,  now(), now()),
  ('nt_plan',     'plan',     'Plan',       'builtin', 1, 'Plan the implementation on a planning agent',                                        'Compass',   '{}', true,  now(), now()),
  ('nt_build',    'build',    'Build',      'builtin', 1, 'Implement the approved plan on an agent',                                            'Hammer',    '{}', true,  now(), now()),
  ('nt_step_build','step_build','Step build','builtin', 1, 'One plan step built by its own child flow (plan fan-out) — per-step branch, diff and approval', 'Hammer', '{}', true, now(), now()),
  ('nt_pipeline', 'pipeline', 'Pipeline',   'builtin', 1, 'Wait for a green CI pipeline, fixing failures',                                      'Gauge',     '{}', true,  now(), now()),
  ('nt_review',   'review',   'Review',     'builtin', 1, 'AI review of the MR diff',                                                           'ScanSearch','{}', true,  now(), now()),
  ('nt_resolve',  'resolve',  'Resolve',    'builtin', 1, 'Address open MR comments',                                                           'CheckCheck','{}', true,  now(), now())
ON CONFLICT (id) DO NOTHING;

-- ── the SDLC loop flow template (plan → build → pipeline → review → resolve) ─
INSERT INTO flow_templates (id, name, description, version, is_builtin, trigger, hidden, created_at, updated_at)
VALUES ('tpl_sdlc_loop', 'SDLC loop', 'The built-in software development loop: plan → build → pipeline → review → resolve.', 1, true, '{"type":"manual"}', false, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO flow_template_nodes (id, template_id, node_key, node_template_id, label, trigger, join_mode, config, input_map, created_at, updated_at) VALUES
  ('ftn_plan',     'tpl_sdlc_loop', 'plan',     'nt_plan',     NULL, '{"type":"manual"}',                          'all', '{}', '{}', now(), now()),
  ('ftn_build',    'tpl_sdlc_loop', 'build',    'nt_build',    NULL, '{"type":"approval"}',                        'all', '{}', '{}', now(), now()),
  ('ftn_pipeline', 'tpl_sdlc_loop', 'pipeline', 'nt_pipeline', NULL, '{"type":"auto","wait_for":"pipeline"}',      'all', '{}', '{}', now(), now()),
  ('ftn_review',   'tpl_sdlc_loop', 'review',   'nt_review',   NULL, '{"type":"auto"}',                            'all', '{}', '{}', now(), now()),
  ('ftn_resolve',  'tpl_sdlc_loop', 'resolve',  'nt_resolve',  NULL, '{"type":"debounced","minutes":10,"wait_for":"comments"}', 'all', '{}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- The loop is template data now: resolve re-enters the CI gate only when the
-- resolve agent actually pushed code (JSONata over the resolve output
-- contract); a no-code fix ends the cycle. Condition-less loop edges stay
-- display metadata.
INSERT INTO flow_template_edges (id, template_id, from_key, to_key, kind, label, condition, created_at, updated_at) VALUES
  ('fte_plan_build',        'tpl_sdlc_loop', 'plan',     'build',    'next', NULL, NULL, now(), now()),
  ('fte_build_pipeline',    'tpl_sdlc_loop', 'build',    'pipeline', 'next', NULL, NULL, now(), now()),
  ('fte_pipeline_review',   'tpl_sdlc_loop', 'pipeline', 'review',   'next', NULL, NULL, now(), now()),
  ('fte_review_resolve',    'tpl_sdlc_loop', 'review',   'resolve',  'next', NULL, NULL, now(), now()),
  ('fte_resolve_pipeline',  'tpl_sdlc_loop', 'resolve',  'pipeline', 'loop', NULL, 'nodes.resolve.output.pushed = true', now(), now())
ON CONFLICT DO NOTHING;

-- Migrate older seedings: the display-only `resolve → review` loop edge
-- becomes the real re-entry `resolve → pipeline` edge (conditioned on the
-- resolve output contract). Idempotent: deterministic edge ids.
DELETE FROM flow_template_edges
WHERE template_id = 'tpl_sdlc_loop' AND id = 'fte_resolve_review'
  AND from_key = 'resolve' AND kind = 'loop';

-- ── plan fan-out: the built-in step template ────────────────────────────────
-- The child template a fan-out `build` node defaults to (`child` unset).
-- `hidden` keeps it out of the gallery (it is a child template; the fan-out
-- knob references it by id, never the picker).
INSERT INTO flow_templates (id, name, description, version, is_builtin, trigger, hidden, created_at, updated_at)
VALUES ('tpl_step_build', 'Step build', 'One plan step built by its own child flow — per-step branch, diff and approval gate (fan-out child of the build node).', 1, true, '{"type":"manual"}', true, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO flow_template_nodes (id, template_id, node_key, node_template_id, label, trigger, join_mode, config, input_map, created_at, updated_at)
VALUES ('ftn_tpl_step_build_step_build', 'tpl_step_build', 'step_build', 'nt_step_build', NULL, '{"type":"approval"}', 'all', '{}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ── starter templates ───────────────────────────────────────────────────────
-- Declarative catalog rows the starters reference (is_builtin=false — the
-- user may edit/duplicate them like any authored node), then three built-in
-- flow templates exercising agent / decision / http / script + input maps.
-- Configs mirror the docs/flow-templates/*.yaml fixtures so export/import
-- round-trips.
INSERT INTO node_templates (id, key, name, kind, version, description, icon, config, is_builtin, created_at, updated_at) VALUES
  ('nt_st_summarize', 'docs_summary', 'Docs summarize', 'agent', 1,
    'Plan-mode agent that summarizes shipped work into markdown', 'agent',
    '{"mode":"plan","output":"markdown","prompt":"Summarize the shipped work on task {{task.key}} — {{task.summary}}.\nRead the repo at {{repo.local_path}} and cover: user-facing changes,\nconfiguration surface, and gotchas. Write it as markdown."}',
    false, now(), now()),
  ('nt_st_write_doc', 'docs_write', 'Docs write', 'script', 1,
    'Shell script that saves the mapped `doc` field into the repo''s docs/', 'Terminal',
    '{"runtime":"shell","script":"cat > docs/devflow-summary.md\necho ''{\"written\": true}''","cwd":"repo"}',
    false, now(), now()),
  ('nt_st_release_notes', 'release_notes', 'Release notes draft', 'agent', 1,
    'Plan-mode agent that drafts release notes from the task', 'agent',
    '{"mode":"plan","output":"markdown","prompt":"Draft release notes for task {{task.key}} ({{task.summary}}).\nLead with user impact, then notable behavior changes and migrations. Under 200 words."}',
    false, now(), now()),
  ('nt_st_ship_decision', 'ship_decision', 'Ship decision', 'decision', 1,
    'Manual choice: send the draft out or drop it', 'Split',
    '{"source":"manual","choices":[{"label":"send","description":"Good enough — notify the webhook"},{"label":"drop","description":"Not ready — skip the notify"}]}',
    false, now(), now()),
  ('nt_st_notify', 'notify_slack', 'Notify webhook', 'http', 1,
    'Outbound HTTP notification ({{secrets.SLACK_WEBHOOK}} resolves at run time)', 'Send',
    '{"url":"{{secrets.SLACK_WEBHOOK}}","method":"POST","body":"Release notes:\n\n{{nodes.release_notes.output.markdown}}"}',
    false, now(), now()),
  ('nt_st_triage', 'triage_agent', 'Sentry triage', 'agent', 1,
    'Plan-mode agent that triages a Sentry issue into structured JSON', 'agent',
    '{"mode":"plan","output":"json","prompt":"Triage this Sentry issue: {{trigger.payload.issue.title}}\n\nStacktrace:\n{{trigger.payload.issue.stacktrace}}\nTask context: {{task.key}} — {{task.summary}}\n\nScan the codebase for the likely cause, then output JSON: {severity, summary, suggested_fix}.","output_schema":{"type":"object","required":["severity","summary"],"properties":{"severity":{"type":"string","enum":["low","med","high"]},"summary":{"type":"string"},"suggested_fix":{"type":"string"}}}}',
    false, now(), now()),
  ('nt_st_worth_fixing', 'worth_fixing', 'Worth fixing?', 'decision', 1,
    'Agent proposes; with trigger: approval the user disposes (§4.3)', 'Split',
    '{"source":"agent","question":"Given the triage result, is this issue worth an automated fix PR?","choices":[{"label":"fix","description":"Real user-facing bug with a plausible localized fix"},{"label":"ignore","description":"Noise, duplicate, or too risky to auto-fix"}]}',
    false, now(), now()),
  ('nt_st_open_pr', 'open_pr', 'Open fix PR', 'agent', 1,
    'Agent-mode run with repo access that fixes the triaged issue', 'Bot',
    '{"mode":"agent","prompt":"Fix the issue: {{nodes.triage.output.suggested_fix}} — issue {{task.key}}."}',
    false, now(), now()),
  ('nt_st_triage_notify', 'triage_notify', 'Notify webhook', 'http', 1,
    'Outbound notification with the triage summary (secrets resolve at run time)', 'Send',
    '{"url":"{{secrets.SLACK_WEBHOOK}}","method":"POST","body":"{ \"text\": \"Triaged {{task.key}}: {{nodes.triage.output.summary}}\" }"}',
    false, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO flow_templates (id, name, description, version, is_builtin, trigger, hidden, created_at, updated_at) VALUES
  ('tpl_docs_generation', 'Docs generation',
    'Summarize shipped work on a task into a docs page in the repo — starter: agent → script with input mapping.', 1, true, '{"type":"manual"}', false, now(), now()),
  ('tpl_release_notify', 'Release notes + notify',
    'Draft release notes from a task, decide whether to ship them, and notify a webhook — starter: agent → decision (manual) → http.', 1, true, '{"type":"manual"}', false, now(), now()),
  ('tpl_sentry_triage', 'Sentry triage',
    'Inbound-webhook triage: agent triages a Sentry issue, an agent-proposes / approval-disposes decision branches fix/ignore, Slack gets notified. Duplicate to bind a task type + repo.', 1, true, '{"type":"webhook","filter":"payload.event = ''issue.created''"}', false, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO flow_template_nodes (id, template_id, node_key, node_template_id, label, trigger, join_mode, config, input_map, created_at, updated_at) VALUES
  ('ftn_docs_generation_summarize',  'tpl_docs_generation',  'summarize',     'nt_st_summarize',     NULL, '{"type":"auto"}', 'all', '{}', '{}', now(), now()),
  ('ftn_docs_generation_write_doc',  'tpl_docs_generation',  'write_doc',     'nt_st_write_doc',     NULL, '{"type":"auto"}', 'all', '{}', '{"doc":"nodes.summarize.output.markdown"}', now(), now()),
  ('ftn_release_notify_release_notes','tpl_release_notify',  'release_notes', 'nt_st_release_notes', NULL, '{"type":"auto"}', 'all', '{}', '{}', now(), now()),
  ('ftn_release_notify_ship_decision','tpl_release_notify',  'ship_decision', 'nt_st_ship_decision', NULL, '{"type":"auto"}', 'all', '{}', '{}', now(), now()),
  ('ftn_release_notify_notify',      'tpl_release_notify',  'notify',        'nt_st_notify',        NULL, '{"type":"auto"}', 'all', '{}', '{}', now(), now()),
  ('ftn_sentry_triage_triage',       'tpl_sentry_triage',   'triage',        'nt_st_triage',        NULL, '{"type":"auto"}', 'all', '{}', '{"summary":"trigger.payload.issue.title","stack":"trigger.payload.issue.stacktrace"}', now(), now()),
  ('ftn_sentry_triage_worth_fixing', 'tpl_sentry_triage',   'worth_fixing',  'nt_st_worth_fixing',  NULL, '{"type":"approval"}', 'all', '{}', '{}', now(), now()),
  ('ftn_sentry_triage_open_pr',      'tpl_sentry_triage',   'open_pr',       'nt_st_open_pr',       NULL, '{"type":"auto"}', 'all', '{}', '{}', now(), now()),
  ('ftn_sentry_triage_notify',       'tpl_sentry_triage',   'notify',        'nt_st_triage_notify', NULL, '{"type":"auto"}', 'all', '{}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO flow_template_edges (id, template_id, from_key, to_key, kind, label, condition, created_at, updated_at) VALUES
  ('fte_docs_generation_summarize_write_doc',   'tpl_docs_generation', 'summarize',     'write_doc',    'next', NULL, NULL, now(), now()),
  ('fte_release_notify_release_notes_ship_decision', 'tpl_release_notify', 'release_notes', 'ship_decision', 'next', NULL, NULL, now(), now()),
  ('fte_release_notify_ship_decision_notify',   'tpl_release_notify',  'ship_decision', 'notify',       'next', 'send', NULL, now(), now()),
  ('fte_sentry_triage_triage_worth_fixing',     'tpl_sentry_triage',   'triage',        'worth_fixing', 'next', NULL, NULL, now(), now()),
  ('fte_sentry_triage_worth_fixing_open_pr',    'tpl_sentry_triage',   'worth_fixing',  'open_pr',      'next', 'fix', NULL, now(), now()),
  ('fte_sentry_triage_triage_notify',           'tpl_sentry_triage',   'triage',        'notify',       'next', NULL, NULL, now(), now())
ON CONFLICT DO NOTHING;
