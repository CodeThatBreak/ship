/**
 * Step-01 codemod (ts-morph): sync→async conversion of db call sites.
 *
 * For every call expression `<recv>.<method>(...)` where recv is `db`, `rows`,
 * `this.db`, `this.rows`, `database` and method ∈ {get, all, run, emitEvent,
 * addMessage, listMessages, listEvents, listEventsTail, getSetting, setSetting,
 * listRepos, repoById, repoByCloudUrl, upsertRepo, deleteRepo,
 * countFlowsByRepoId, transaction}:
 *   1. wrap in `await` (if not already)
 *   2. mark the enclosing function `async` (recursively for arrow callers)
 * Also converts snake_case property access on known row variable names is left
 * to a second explicit pass (--props).
 */
import { Project, SyntaxKind } from "ts-morph";

const CALLS = new Set([
  "get", "all", "run", "emitEvent", "addMessage", "listMessages", "listEvents",
  "listEventsTail", "getSetting", "setSetting", "listRepos", "repoById",
  "repoByCloudUrl", "upsertRepo", "deleteRepo", "countFlowsByRepoId", "transaction",
]);
const RECVS = new Set(["db", "rows", "database"]);
const PROP_MAP = {
  task_id: "taskId", mr_url: "mrUrl", mr_iid: "mrIid", mr_branch: "mrBranch",
  repo_url: "repoUrl", gitlab_project_id: "gitlabProjectId", current_node: "currentNode",
  execution_mode: "executionMode", repo_id: "repoId", template_id: "templateId",
  template_graph: "templateGraph", trigger_payload: "triggerPayload",
  worktree_dir: "worktreeDir", parent_flow_id: "parentFlowId",
  created_at: "createdAt", updated_at: "updatedAt", flow_id: "flowId",
  node_key: "nodeKey", attempt_id: "attemptId", agent_id: "agentId",
  agent_ref: "agentRef", session_id: "sessionId", prompt_override: "promptOverride",
  join_mode: "joinMode", node_id: "nodeId", discussion_id: "discussionId",
  file_path: "filePath", resolved_by: "resolvedBy", artifact_id: "artifactId",
  meta_id: "metaId", completed_by: "completedBy", sub_flow_id: "subFlowId",
  git_branch: "gitBranch", run_ref: "runRef", branch_id: "branchId",
  input_tokens: "inputTokens", output_tokens: "outputTokens",
  cache_read_tokens: "cacheReadTokens", cache_write_tokens: "cacheWriteTokens",
  duration_ms: "durationMs", cost_cents: "costCents", cloud_url: "cloudUrl",
  local_path: "localPath", default_branch: "defaultBranch", use_worktrees: "useWorktrees",
  install_command: "installCommand", skip_install: "skipInstall", sync_paths: "syncPaths",
  shared_dirs: "sharedDirs", setup_command: "setupCommand",
  worktree_timeout_ms: "worktreeTimeoutMs", base_url: "baseUrl", is_builtin: "isBuiltin",
  schedule_next_at: "scheduleNextAt", node_template_id: "nodeTemplateId",
  input_map: "inputMap", from_key: "fromKey", to_key: "toKey",
  hook_id: "hookId", webhook_id: "webhookId", parent_node: "parentNode",
  issue_type: "issueType", parent_key: "parentKey", external_url: "externalUrl",
  synced_at: "syncedAt", delete_branch: "deleteBranch", repo_path: "repoPath",
};

const isDbRecv = (expr) => {
  if (!expr) return false;
  if (expr.getKind() === SyntaxKind.Identifier) {
    return RECVS.has(expr.getText());
  }
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const text = expr.getText();
    return text === "this.db" || text === "this.rows" || text === "this.database";
  }
  return false;
};

function makeAsync(fn) {
  if (!fn) return;
  const kind = fn.getKind();
  if (
    kind === SyntaxKind.MethodDeclaration ||
    kind === SyntaxKind.FunctionDeclaration ||
    kind === SyntaxKind.ArrowFunction ||
    kind === SyntaxKind.FunctionExpression ||
    kind === SyntaxKind.GetAccessor ||
    kind === SyntaxKind.SetAccessor
  ) {
    if (!fn.isAsync()) fn.setIsAsync(true);
  }
}

function processFile(sourceFile) {
  let touched = false;
  // collect targets first (mutating while iterating invalidates nodes)
  const targets = [];
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const prop = expr.getName();
    if (!CALLS.has(prop)) continue;
    const recv = expr.getExpression();
    if (!isDbRecv(recv)) continue;
    const parent = call.getParent();
    if (parent && parent.getKind() === SyntaxKind.AwaitExpression) continue;
    targets.push(call);
  }
  for (const call of targets) {
    // re-validate: a previous edit may have rewritten this node's text range
    if (call.wasForgotten()) continue;
    const parent = call.getParent();
    if (parent && parent.getKind() === SyntaxKind.AwaitExpression) continue;
    const text = call.getText();
    call.replaceWithText(`await ${text}`);
    touched = true;
  }
  // mark every function that now contains an await but isn't async
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.AwaitExpression) return;
    const fn = node.getFirstAncestor((a) =>
      [
        SyntaxKind.MethodDeclaration,
        SyntaxKind.FunctionDeclaration,
        SyntaxKind.ArrowFunction,
        SyntaxKind.FunctionExpression,
      ].includes(a.getKind())
    );
    if (fn && !fn.isAsync()) {
      fn.setIsAsync(true);
      touched = true;
    }
  });
  // db.transaction(() => { → db.transaction(async (tx) => { … ; void tx; })
  // (handled naturally by the await pass; add async + tx param)
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node;
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    if (expr.getName() !== "transaction") return;
    const recv = expr.getExpression();
    if (!isDbRecv(recv)) return;
    const arg = call.getArguments()[0];
    if (arg && arg.getKind() === SyntaxKind.ArrowFunction) {
      const arrow = arg;
      arrow.setIsAsync(true);
      if (arrow.getParameters().length === 0) {
        arrow.addParameter({ name: "tx" });
        const body = arrow.getBody();
        if (body.getKind() === SyntaxKind.Block) {
          body.addStatements("void tx;");
        }
      }
      touched = true;
    }
  });
  return touched;
}

function processProps(sourceFile) {
  let touched = false;
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const pa = node;
    const name = pa.getName();
    if (PROP_MAP[name] && PROP_MAP[name] !== name) {
      pa.getNameNode().replaceWithText(PROP_MAP[name]);
      touched = true;
    }
  });
  return touched;
}

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const mode = process.argv[2];
const files = process.argv.slice(3);
for (const f of files) {
  const sf = project.addSourceFileAtPath(f);
  let touched = false;
  if (mode === "async") touched = processFile(sf);
  if (mode === "props") touched = processProps(sf);
  if (touched) {
    sf.saveSync();
    console.log("converted", f);
  }
}
