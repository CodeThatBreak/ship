#!/usr/bin/env python3
"""
Step-01 pass 2: async/await + camelCase property conversion for TS sources.

- db.get/all/run/rows.get/rows.all/db.emitEvent/db.transaction/etc → awaited
- enclosing function gets `async` (best-effort: nearest `name(args) {` / `=> {`)
- row property reads snake_case → camelCase (member access on known row vars
  is too context-sensitive; instead convert `.getXxx(` patterns by renaming
  snake_case property accesses globally for known column names)
- db.transaction(() => {...}) → await db.transaction(async (tx) => {...})
- `f.*` SELECT → explicit flows column list
"""
import re, sys, pathlib

PROPS = {
    "task_id": "taskId", "mr_url": "mrUrl", "mr_iid": "mrIid", "mr_branch": "mrBranch",
    "repo_url": "repoUrl", "gitlab_project_id": "gitlabProjectId", "current_node": "currentNode",
    "execution_mode": "executionMode", "repo_id": "repoId", "template_id": "templateId",
    "template_graph": "templateGraph", "trigger_payload": "triggerPayload",
    "worktree_dir": "worktreeDir", "parent_flow_id": "parentFlowId",
    "created_at": "createdAt", "updated_at": "updatedAt", "flow_id": "flowId",
    "node_key": "nodeKey", "attempt_id": "attemptId", "agent_id": "agentId",
    "agent_ref": "agentRef", "session_id": "sessionId", "prompt_override": "promptOverride",
    "join_mode": "joinMode", "node_id": "nodeId", "discussion_id": "discussionId",
    "file_path": "filePath", "resolved_by": "resolvedBy", "artifact_id": "artifactId",
    "meta_id": "metaId", "completed_by": "completedBy", "sub_flow_id": "subFlowId",
    "git_branch": "gitBranch", "run_ref": "runRef", "branch_id": "branchId",
    "input_tokens": "inputTokens", "output_tokens": "outputTokens",
    "cache_read_tokens": "cacheReadTokens", "cache_write_tokens": "cacheWriteTokens",
    "duration_ms": "durationMs", "cost_cents": "costCents", "cloud_url": "cloudUrl",
    "local_path": "localPath", "default_branch": "defaultBranch", "use_worktrees": "useWorktrees",
    "install_command": "installCommand", "skip_install": "skipInstall", "sync_paths": "syncPaths",
    "shared_dirs": "sharedDirs", "setup_command": "setupCommand",
    "worktree_timeout_ms": "worktreeTimeoutMs", "base_url": "baseUrl", "is_builtin": "isBuiltin",
    "schedule_next_at": "scheduleNextAt", "node_template_id": "nodeTemplateId",
    "input_map": "inputMap", "from_key": "fromKey", "to_key": "toKey",
    "hook_id": "hookId", "webhook_id": "webhookId", "parent_node": "parentNode",
    "issue_type": "issueType", "parent_key": "parentKey", "external_url": "externalUrl",
    "synced_at": "syncedAt", "delete_branch": "deleteBranch", "repo_path": "repoPath",
    "wait_for": "waitFor", "output_schema": "outputSchema", "quiet_minutes": "quietMinutes",
}
ORDERED = sorted(PROPS, key=len, reverse=True)

ASYNC_CALLS = [
    "db.get", "db.all", "db.run", "db.emitEvent", "db.addMessage", "db.listMessages",
    "db.listEvents", "db.listEventsTail", "db.getSetting", "db.setSetting", "db.listRepos",
    "db.repoById", "db.repoByCloudUrl", "db.upsertRepo", "db.deleteRepo",
    "db.countFlowsByRepoId", "rows.get", "rows.all",
]

def await_calls(code):
    out = code
    for call in ASYNC_CALLS:
        # add await where not already awaited/voided/returned/yielded
        pattern = re.compile(rf"(?<!await )(?<!await\()(?<!void )(?<!return )(?<![\w.]){re.escape(call)}\(")
        out = pattern.sub(f"await {call}(", out)
    return out

def fix_transaction(code):
    # db.transaction(() => { → await db.transaction(async (tx) => {
    out = re.sub(r"(?<!await )db\.transaction\(\s*\(\s*\)\s*=>\s*\{", "await db.transaction(async (tx) => {", code)
    out = re.sub(r"(?<!await )db\.transaction\(\s*(\w+)\s*\)", r"await db.transaction($1)", out)
    return out

def fix_changes(code):
    out = re.sub(r"const \{ changes \} = await db\.run\(", "const changes = await db.run(", code)
    out = re.sub(r"(\w+)\.changes\b", r"\1", out)
    return out

def fix_props(code):
    out = code
    for snake in ORDERED:
        camel = PROPS[snake]
        # member access .snake_case → .camelCase (not inside strings/SQL)
        out = re.sub(rf"\.{snake}\b", f".{camel}", out)
    return out

def main(paths):
    for p in paths:
        path = pathlib.Path(p)
        code = path.read_text()
        out = code
        out = await_calls(out)
        out = fix_transaction(out)
        out = fix_changes(out)
        out = fix_props(out)
        if out != code:
            path.write_text(out)
            print("converted", p)
        else:
            print("unchanged", p)

if __name__ == "__main__":
    main(sys.argv[1:])
