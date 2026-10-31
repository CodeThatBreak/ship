import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validateLocalPath(p: string | null | undefined): string | null {
  if (!p) return null;
  const expanded = p.startsWith("~")
    ? path.join(process.env.HOME ?? "", p.slice(1))
    : p;
  return expanded;
}

/** Optional string fields: absent/empty → null. */
function optString(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/** Optional worktree timeout in SECONDS (form unit) → ms in the DB; invalid/absent → null. */
function optTimeoutMs(v: unknown): number | null {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

export async function GET() {
  const repos = db.listRepos().map((r) => ({
    ...r,
    local_path_exists: r.local_path ? fs.existsSync(path.join(r.local_path, ".git")) : false,
  }));
  return NextResponse.json({ repos });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name || !body.cloud_url) {
    return NextResponse.json({ error: "name and cloud_url are required" }, { status: 400 });
  }
  const localPath = validateLocalPath(body.local_path);
  if (localPath && !fs.existsSync(path.join(localPath, ".git"))) {
    return NextResponse.json(
      { error: `Local path is not a git repository: ${localPath}` },
      { status: 400 }
    );
  }
  const repo = db.upsertRepo({
    name: body.name,
    cloud_url: body.cloud_url,
    local_path: localPath,
    default_branch: body.default_branch || "main",
    // worktree setup policy (Phase 2)
    install_command: optString(body.install_command),
    skip_install: Boolean(body.skip_install),
    sync_paths: optString(body.sync_paths),
    shared_dirs: optString(body.shared_dirs),
    setup_command: optString(body.setup_command),
    worktree_timeout_ms: optTimeoutMs(body.worktree_timeout_s),
  });
  return NextResponse.json({ repo });
}
