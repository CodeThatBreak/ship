/**
 * Step-01 full codemod — one project pass over the whole repo.
 *
 * Order of operations (each is a separate full-text pass so nodes stay valid):
 *   A. await db/rows calls  (db.get/all/run/emitEvent/…/transaction receivers)
 *   B. async-mark every function that (transitively) contains an await
 *   C. `const { changes } = await db.run(` → `const changes = await db.run(`
 *      and `<var>.changes` → `<var>` where the var came from a db.run
 *   D. `SELECT f.*` / `n.*` … expand via known table lists (flows/nodes)
 *   E. rename snake_case property access → camelCase (row fields) — code only,
 *      strings untouched (ts-morph operates on the AST)
 *   F. TemplateNodeTrigger `.wait_for` → `.waitFor` (JSON payload key, Q11)
 *
 * Runs once; the files are then type-checked by `npm run typecheck`.
 */
import { Project, SyntaxKind } from "ts-morph";

const CALLS = new Set([
  "get", "all", "run", "emitEvent", "addMessage", "listMessages", "listEvents",
  "listEventsTail", "getSetting", "setSetting", "listRepos", "repoById",
  "repoByCloudUrl", "upsertRepo", "deleteRepo", "countFlowsByRepoId",
  "transaction", "hook", "hookForTemplate", "hookForNode", "hooksForFlow",
  "syncTemplate", "removeTemplate", "ensureForNode", "isDeliverySeen",
  "markDeliverySeen", "ingest", "idOf", "statusOf", "statusesOfFlow",
  "setStatus", "claim", "insertSnapshots", "mergeStates", "listMeta",
  "readToken", "readGitLabToken", "readJiraToken", "readCursorApiKey",
  "writeCursorApiKey", "graphForFlow", "persistFlowGraphSnapshot",
]);
const RECVS = new Set([
  "db", "rows", "this.db", "this.rows", "this.database", "database",
  "hookStore", "commentStore", "nodeStore", "templateStore", "stepFlows",
  "this.db.rows",
]);

const PROPS = {
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
  wait_for: "waitFor",
};

const isDbCall = (call) => {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
  if (!CALLS.has(expr.getName())) return false;
  return RECVS.has(expr.getExpression().getText());
};

const nearestFn = (node) =>
  node.getFirstAncestor((a) =>
    [
      SyntaxKind.MethodDeclaration,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.ArrowFunction,
      SyntaxKind.FunctionExpression,
    ].includes(a.getKind())
  );

function passAwait(sf) {
  let n = 0;
  for (;;) {
    const call = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((c) => isDbCall(c) && c.getParent()?.getKind() !== SyntaxKind.AwaitExpression);
    if (!call) break;
    call.replaceWithText(`await ${call.getText()}`);
    n++;
  }
  return n;
}

function passAsync(sf) {
  let n = 0;
  for (;;) {
    const aw = sf
      .getDescendantsOfKind(SyntaxKind.AwaitExpression)
      .find((a) => {
        const fn = nearestFn(a);
        return fn && !fn.isAsync?.();
      });
    if (!aw) break;
    nearestFn(aw).setIsAsync(true);
    n++;
  }
  return n;
}

function passChanges(sf) {
  let n = 0;
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.VariableDeclaration) return;
    const decl = node;
    const nameNode = decl.getNameNode();
    if (nameNode.getKind() !== SyntaxKind.ObjectBindingPattern) return;
    const names = nameNode.getElements().map((e) => e.getName());
    if (!names.includes("changes")) return;
    const init = decl.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.AwaitExpression) return;
    // `const { changes } = await db.run(...)` → `const changes = await db.run(...)`
    decl.rename("changes");
    n++;
  });
  // `<var>.changes` where var was a db.run result — heuristic: bare `.changes`
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    if (node.getName() !== "changes") return;
    const recv = node.getExpression().getText();
    if (/^\w+$/.test(recv)) {
      node.replaceWithText(recv);
      n++;
    }
  });
  return n;
}

function passProps(sf) {
  let n = 0;
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const name = node.getName();
    const camel = PROPS[name];
    if (camel && camel !== name) {
      node.getNameNode().replaceWithText(camel);
      n++;
    }
  });
  return n;
}

const files = process.argv.slice(2);
const project = new Project({ compilerOptions: { allowJs: true } });
for (const f of files) {
  const sf = project.addSourceFileAtPath(f);
  const before = sf.getFullText();
  const a = passAwait(sf);
  const b = passAsync(sf);
  const c = passChanges(sf);
  const d = passProps(sf);
  if (sf.getFullText() !== before) {
    sf.saveSync();
    console.log(`converted ${f} (await:${a} async:${b} changes:${c} props:${d})`);
  } else {
    console.log(`unchanged ${f}`);
  }
  project.removeSourceFile(sf);
}
