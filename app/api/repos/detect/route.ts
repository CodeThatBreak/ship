import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { depPolicies } from "../../../../lib/git/dep-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Expand `~` the same way the repo save routes do. */
function expandLocalPath(p: string | null): string | null {
  if (!p) return null;
  return p.startsWith("~") ? path.join(process.env.HOME ?? "", p.slice(1)) : p;
}

/**
 * GET /api/repos/detect?local_path=… — the worktree setup policy DevFlow would
 * apply with NO per-repo overrides, resolved by lib/git/dep-policy.ts against
 * the repo's local checkout. Used to prefill the repo form so the user sees
 * what's going to be applied instead of trusting invisible auto-detection.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("local_path");
  const hubPath = expandLocalPath(raw);
  let policy: ReturnType<typeof depPolicies.resolve> | null = null;
  if (hubPath && fs.existsSync(hubPath)) {
    policy = depPolicies.resolve({ hubPath });
  }
  return NextResponse.json({
    // clone strategies run no command (deps are copied from the hub) — the
    // frozen-install fallback is what actually runs in the worktree
    install_command: policy?.command ?? policy?.fallback?.command ?? null,
    sync_paths: depPolicies.resolveSyncGlobs(null).join("\n"),
    // symlinks have no auto default (caches are copied, not symlinked)
    shared_dirs: null,
    source: policy?.source ?? "no local checkout",
  });
}
