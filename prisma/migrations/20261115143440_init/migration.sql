-- CreateEnum
CREATE TYPE "flow_status" AS ENUM ('active', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "flow_kind" AS ENUM ('sdlc', 'step', 'split');

-- CreateEnum
CREATE TYPE "node_status" AS ENUM ('pending', 'waiting', 'running', 'awaiting_approval', 'approved', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "artifact_status" AS ENUM ('draft', 'approved', 'superseded');

-- CreateEnum
CREATE TYPE "comment_status" AS ENUM ('open', 'resolving', 'resolved', 'wontfix');

-- CreateEnum
CREATE TYPE "plan_step_status" AS ENUM ('pending', 'done');

-- CreateEnum
CREATE TYPE "branch_status" AS ENUM ('pending', 'building', 'awaiting_approval', 'approved', 'failed', 'done');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('running', 'finished', 'error', 'cancelled');

-- CreateEnum
CREATE TYPE "step_merge_status" AS ENUM ('running', 'conflict', 'rejected', 'merged', 'failed');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "node_template_kind" AS ENUM ('builtin', 'agent', 'http', 'script', 'decision');

-- CreateEnum
CREATE TYPE "edge_kind" AS ENUM ('next', 'loop');

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT,
    "issue_type" TEXT,
    "priority" TEXT,
    "repo_url" TEXT,
    "parent_key" TEXT,
    "external_url" TEXT,
    "raw" TEXT,
    "synced_at" TIMESTAMPTZ,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "flow_status" NOT NULL DEFAULT 'active',
    "mr_url" TEXT,
    "mr_iid" INTEGER,
    "mr_branch" TEXT,
    "repo_url" TEXT,
    "gitlab_project_id" INTEGER,
    "current_node" TEXT,
    "execution_mode" TEXT NOT NULL DEFAULT 'cloud',
    "repo_id" TEXT,
    "template_id" TEXT,
    "templateGraph" JSONB,
    "trigger_payload" JSONB,
    "worktree_dir" TEXT,
    "parent_flow_id" TEXT,
    "kind" "flow_kind" NOT NULL DEFAULT 'sdlc',
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "node_status" NOT NULL DEFAULT 'pending',
    "attempt_id" TEXT,
    "agent_id" TEXT,
    "agent_ref" TEXT,
    "session_id" TEXT,
    "prompt_override" TEXT,
    "label" TEXT,
    "config" JSONB,
    "join_mode" TEXT,
    "input" JSONB,
    "output" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "status" "artifact_status" NOT NULL DEFAULT 'draft',
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "mr_iid" INTEGER,
    "discussion_id" TEXT,
    "author" TEXT,
    "body" TEXT,
    "file_path" TEXT,
    "line" INTEGER,
    "status" "comment_status" NOT NULL DEFAULT 'open',
    "resolved_by" TEXT,
    "raw" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "node_key" TEXT,
    "thread" TEXT,
    "role" "message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "node_id" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_steps" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "artifact_id" TEXT,
    "meta_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "files" JSONB,
    "branch" TEXT,
    "status" "plan_step_status" NOT NULL DEFAULT 'pending',
    "origin" TEXT NOT NULL DEFAULT 'agent',
    "completed_by" TEXT,
    "sub_flow_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "git_branch" TEXT,
    "title" TEXT,
    "status" "branch_status" NOT NULL DEFAULT 'pending',
    "mr_url" TEXT,
    "mr_iid" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "agent_ref" TEXT NOT NULL,
    "run_ref" TEXT NOT NULL,
    "branch_id" TEXT,
    "status" "run_status" NOT NULL DEFAULT 'running',
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "duration_ms" INTEGER,
    "cost_cents" INTEGER,
    "usage" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repos" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cloud_url" TEXT NOT NULL,
    "local_path" TEXT,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "use_worktrees" BOOLEAN NOT NULL DEFAULT true,
    "install_command" TEXT,
    "skip_install" BOOLEAN NOT NULL DEFAULT false,
    "sync_paths" TEXT,
    "shared_dirs" TEXT,
    "setup_command" TEXT,
    "worktree_timeout_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gitlab_instances" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "base_url" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gitlab_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jira_instances" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "base_url" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "jira_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "node_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "node_template_kind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "icon" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "template_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "node_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "trigger" JSONB NOT NULL DEFAULT '{"type":"manual"}',
    "schedule_next_at" TIMESTAMPTZ,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "flow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_template_nodes" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "node_template_id" TEXT NOT NULL,
    "label" TEXT,
    "trigger" JSONB NOT NULL DEFAULT '{"type":"auto"}',
    "join_mode" TEXT NOT NULL DEFAULT 'all',
    "config" JSONB NOT NULL DEFAULT '{}',
    "input_map" JSONB NOT NULL DEFAULT '{}',
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "flow_template_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_template_edges" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "from_key" TEXT NOT NULL,
    "to_key" TEXT NOT NULL,
    "kind" "edge_kind" NOT NULL DEFAULT 'next',
    "label" TEXT,
    "condition" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "flow_template_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hooks" (
    "id" TEXT NOT NULL,
    "template_id" TEXT,
    "flow_id" TEXT,
    "node_key" TEXT,
    "secret" TEXT NOT NULL,
    "filter" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hook_deliveries" (
    "hook_id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL
);

-- CreateTable
CREATE TABLE "worktree_removals" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT,
    "repo_path" TEXT,
    "path" TEXT NOT NULL,
    "branch" TEXT,
    "delete_branch" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "worktree_removals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_merges" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "parent_flow_id" TEXT NOT NULL,
    "parent_node" TEXT NOT NULL,
    "branch" TEXT,
    "status" "step_merge_status" NOT NULL DEFAULT 'running',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "step_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_key_key" ON "tasks"("key");

-- CreateIndex
CREATE INDEX "idx_flows_parent" ON "flows"("parent_flow_id");

-- CreateIndex
CREATE INDEX "idx_flows_gitlab_project" ON "flows"("gitlab_project_id");

-- CreateIndex
CREATE INDEX "idx_flows_status" ON "flows"("status");

-- CreateIndex
CREATE INDEX "idx_flows_template" ON "flows"("template_id");

-- CreateIndex
CREATE INDEX "idx_flows_repo" ON "flows"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_flow_id_node_key_key" ON "nodes"("flow_id", "node_key");

-- CreateIndex
CREATE INDEX "idx_artifacts_node" ON "artifacts"("node_id", "kind", "version");

-- CreateIndex
CREATE INDEX "idx_comments_flow" ON "comments"("flow_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comments_discussion_id_id_key" ON "comments"("discussion_id", "id");

-- CreateIndex
CREATE INDEX "idx_messages_flow" ON "messages"("flow_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_events_flow" ON "events"("flow_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_plan_steps_flow" ON "plan_steps"("flow_id", "position");

-- CreateIndex
CREATE INDEX "idx_plan_steps_sub_flow" ON "plan_steps"("sub_flow_id");

-- CreateIndex
CREATE INDEX "idx_branches_flow" ON "branches"("flow_id", "status");

-- CreateIndex
CREATE INDEX "idx_branches_mr" ON "branches"("mr_iid");

-- CreateIndex
CREATE UNIQUE INDEX "branches_flow_id_name_key" ON "branches"("flow_id", "name");

-- CreateIndex
CREATE INDEX "idx_runs_node" ON "runs"("node_id");

-- CreateIndex
CREATE INDEX "idx_runs_flow" ON "runs"("flow_id");

-- CreateIndex
CREATE INDEX "idx_runs_run_ref" ON "runs"("run_ref");

-- CreateIndex
CREATE INDEX "idx_runs_status" ON "runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "repos_cloud_url_key" ON "repos"("cloud_url");

-- CreateIndex
CREATE UNIQUE INDEX "gitlab_instances_base_url_key" ON "gitlab_instances"("base_url");

-- CreateIndex
CREATE UNIQUE INDEX "jira_instances_base_url_key" ON "jira_instances"("base_url");

-- CreateIndex
CREATE UNIQUE INDEX "node_templates_key_version_key" ON "node_templates"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "flow_template_nodes_template_id_node_key_key" ON "flow_template_nodes"("template_id", "node_key");

-- CreateIndex
CREATE UNIQUE INDEX "flow_template_edges_template_id_from_key_to_key_label_key" ON "flow_template_edges"("template_id", "from_key", "to_key", "label");

-- CreateIndex
CREATE INDEX "idx_hook_deliveries_created" ON "hook_deliveries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "hook_deliveries_hook_id_webhook_id_key" ON "hook_deliveries"("hook_id", "webhook_id");

-- CreateIndex
CREATE INDEX "idx_step_merges_parent" ON "step_merges"("parent_flow_id", "parent_node", "status");

-- CreateIndex
CREATE INDEX "idx_step_merges_flow" ON "step_merges"("flow_id");

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "flow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_parent_flow_id_fkey" FOREIGN KEY ("parent_flow_id") REFERENCES "flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_sub_flow_id_fkey" FOREIGN KEY ("sub_flow_id") REFERENCES "flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_templates" ADD CONSTRAINT "node_templates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "flow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_template_nodes" ADD CONSTRAINT "flow_template_nodes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "flow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_template_nodes" ADD CONSTRAINT "flow_template_nodes_node_template_id_fkey" FOREIGN KEY ("node_template_id") REFERENCES "node_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_template_edges" ADD CONSTRAINT "flow_template_edges_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "flow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "flow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hook_deliveries" ADD CONSTRAINT "hook_deliveries_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "hooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_merges" ADD CONSTRAINT "step_merges_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_merges" ADD CONSTRAINT "step_merges_parent_flow_id_fkey" FOREIGN KEY ("parent_flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
