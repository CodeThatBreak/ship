import { NextResponse } from "next/server";
import path from "path";
import type { RepoDepOverrides } from "../../../../lib/git/dep-policy";
import { worktreeSetup } from "../../../../lib/git/worktree-setup";

export const dynamic = "force-dynamic";

/** Expand `~` the same way the repo save routes do. */
function expandLocalPath(p: string): string {
  return p.startsWith("~") ? path.join(process.env.HOME ?? "", p.slice(1)) : p;
}

/** Optional string fields: absent/empty → null (same mapping as the save routes). */
function optString(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/**
 * POST /api/repos/test-setup — dry-run the worktree setup policy the repo form
 * currently describes against its local checkout. Pure advisory: the policy is
 * resolved and every setup surface (shared symlinks, config sync, warm caches,
 * setup command) is validated, but NO worktree is created and nothing is
 * copied, symlinked or executed (commands are only reported).
 */
export async function POST(req: Request) {
  const body = await req.json();
  const localPath = typeof body.local_path === "string" ? body.local_path.trim() : "";
  if (!localPath) {
    return NextResponse.json({ error: "local_path is required" }, { status: 400 });
  }
  const overrides: RepoDepOverrides = {
    install_command: optString(body.install_command),
    skip_install: Boolean(body.skip_install),
    setup_command: optString(body.setup_command),
    sync_paths: optString(body.sync_paths),
    shared_dirs: optString(body.shared_dirs),
  };
  const result = await worktreeSetup.dryRun({ hubPath: expandLocalPath(localPath), overrides });
  return NextResponse.json(result);
}
