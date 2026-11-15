#!/usr/bin/env python3
"""
Step-01 final codemod — string-aware, purely textual.

Transforms (per file, code segments only — template literals & strings skipped):
  1. `db.<m>(` / `rows.<m>(` / `this.db.<m>(` etc → `await db.<m>(` for async methods
  2. enclosing function made `async` (text-based brace matching)
  3. `const { changes } = await db.run(` → `const changes = await db.run(`
  4. `X.changes` (bare identifier) → `X`
  5. `db.transaction(() => {` → `await db.transaction(async (tx) => {`
  6. `db.transaction(fn)` → `await db.transaction(fn)`
Then a property pass: `.snake_case` → `.camelCase` for known row props (code only).
"""
import re, sys, pathlib

CALLS = ["get", "all", "run", "emitEvent", "addMessage", "listMessages", "listEvents",
         "listEventsTail", "getSetting", "setSetting", "listRepos", "repoById",
         "repoByCloudUrl", "upsertRepo", "deleteRepo", "countFlowsByRepoId"]
RECVS = ["db", "rows", "this.db", "this.rows", "this.database", "database",
         "hookStore", "commentStore", "nodeStore", "templateStore", "stepFlows",
         "settingsStore", "repoStore", "eventStore", "messageStore",
         "gitlabInstanceStore", "jiraInstanceStore", "integrationSecrets",
         "this.hookStore", "this.commentStore", "this.nodeStore", "this.rows"]

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
    "wait_for": "waitFor", "task_type": "taskType", "is_local": "isLocal",
    "nt_builtin": "ntBuiltin", "def_key": "defKey", "nt_id": "ntId", "nt_kind": "ntKind",
    "nt_icon": "ntIcon", "nt_name": "ntName",
}
ORDERED = sorted(PROPS, key=len, reverse=True)

def segment(src):
    """split into (is_string, text) segments"""
    segs, i, buf = [], 0, []
    while i < len(src):
        c = src[i]
        if c in "`'\"":
            if buf: segs.append((False, "".join(buf))); buf = []
            q = c; body = [c]; j = i + 1
            while j < len(src):
                body.append(src[j])
                if src[j] == "\\":
                    if j + 1 < len(src): body.append(src[j+1])
                    j += 2; continue
                if src[j] == q: j += 1; break
                j += 1
            segs.append((True, "".join(body))); i = j
        else:
            buf.append(c); i += 1
    if buf: segs.append((False, "".join(buf)))
    return segs

def transform(code):
    out = code
    # await db/rows calls
    for recv in RECVS:
        for m in CALLS:
            out = re.sub(
                rf"(?<![\w.])(?<!await )(?<!await\()(?<!void )(?<!return )(?<![\w])"
                rf"{re.escape(recv)}\.{m}\(",
                f"await {recv}.{m}(", out)
    # db.transaction
    out = re.sub(r"(?<!await )db\.transaction\(\s*\(\s*\)\s*=>\s*\{",
                 "await db.transaction(async (tx) => {", out)
    out = re.sub(r"(?<!await )(?<![\w.])db\.transaction\(", "await db.transaction(", out)
    # changes destructure
    out = re.sub(r"const\s*\{\s*changes\s*\}\s*=\s*await", "const changes = await", out)
    out = re.sub(r"\b(\w+)\.changes\b", r"\1", out)
    # props
    for snake in ORDERED:
        out = re.sub(rf"\.{snake}\b", f".{PROPS[snake]}", out)
    return out

def async_fix(src):
    """add async to functions containing a bare await (text scan)."""
    out = list(src)
    # find 'await ' occurrences in code segments
    segs = segment(src)
    # rebuild with markers of await positions in full text
    # simpler: for each occurrence of 'await ' in code, find enclosing '... {' opener
    inserts = set()
    pos = 0
    for is_str, text in segs:
        base = pos
        pos += len(text)
        if is_str: continue
        for m in re.finditer(r"\bawait ", text):
            a = base + m.start()
            # scan back for enclosing block opener
            depth = 0; j = a
            while j > 0:
                j -= 1
                ch = src[j]
                if ch == "}": depth += 1
                elif ch == "{":
                    if depth == 0:
                        # header: up to 3 lines back
                        ls = src.rfind("\n", 0, j) + 1
                        header = src[ls:j]
                        for _ in range(3):
                            p2 = src.rfind("\n", 0, ls - 1)
                            if p2 == -1: break
                            cand = src[p2+1:j]
                            if re.search(r"[\)=>]\s*$", cand) or "=>" in cand or re.search(r"\b(function|get|set)\b", cand):
                                ls = p2 + 1; header = cand
                            else: break
                        h = header.strip()
                        if not re.match(r"(if|for|while|switch|catch|else|try|do|return)\b", h) \
                           and "async" not in h and h:
                            inserts.add(ls)
                        break
                    depth -= 1
    if not inserts: return src
    parts, prev = [], 0
    for p in sorted(inserts):
        parts.append(src[prev:p])
        k = p
        while k < len(src) and src[k] in " \t": k += 1
        parts.append(src[p:k])
        if not src[k:k+5] == "async":
            parts.append("async ")
        prev = k
    parts.append(src[prev:])
    return "".join(parts)

def main(paths):
    for p in paths:
        path = pathlib.Path(p)
        src = path.read_text()
        segs = segment(src)
        code = "".join(t if not s else t for s, t in segs)
        code = transform(code)
        code = async_fix(code)
        if code != src:
            path.write_text(code)
            print("converted", p)
        else:
            print("unchanged", p)

if __name__ == "__main__":
    main(sys.argv[1:])
