import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Optional string fields: absent = keep, empty = clear. */
function optString(v: unknown, fallback: string | null): string | null {
  if (v === undefined) return fallback;
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/** Optional worktree timeout in SECONDS (form unit) → ms in the DB; absent = keep, invalid/empty = clear. */
function optTimeoutMs(v: unknown, fallback: number | null): number | null {
  if (v === undefined) return fallback;
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = db.repoById(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  let localPath = body.local_path !== undefined ? body.local_path : existing.local_path;
  if (localPath && localPath.startsWith("~")) {
    localPath = path.join(process.env.HOME ?? "", localPath.slice(1));
  }
  if (localPath && !fs.existsSync(path.join(localPath, ".git"))) {
    return NextResponse.json(
      { error: `Local path is not a git repository: ${localPath}` },
      { status: 400 }
    );
  }
  const repo = db.upsertRepo({
    id,
    name: body.name ?? existing.name,
    cloud_url: body.cloud_url ?? existing.cloud_url,
    local_path: localPath || null,
    default_branch: body.default_branch ?? existing.default_branch,
    // worktree setup policy (Phase 2)
    install_command: optString(body.install_command, existing.install_command),
    skip_install: body.skip_install !== undefined ? Boolean(body.skip_install) : Boolean(existing.skip_install),
    sync_paths: optString(body.sync_paths, existing.sync_paths),
    shared_dirs: optString(body.shared_dirs, existing.shared_dirs),
    setup_command: optString(body.setup_command, existing.setup_command),
    worktree_timeout_ms: optTimeoutMs(body.worktree_timeout_s, existing.worktree_timeout_ms),
  });
  return NextResponse.json({ repo });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.deleteRepo(id);
  return NextResponse.json({ ok: true });
}
