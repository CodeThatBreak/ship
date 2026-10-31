import { toErrorResponse } from "@/lib/errors";
import { parseQuery } from "@/lib/http/parse";
import { repoService } from "@/lib/repos";
import { repoDetectQuerySchema } from "@/lib/schemas/repo";
import { NextResponse } from "next/server";
import fs from "fs";
import { depPolicies } from "../../../../lib/git/dep-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/repos/detect?local_path=… — the worktree setup policy DevFlow would
 * apply with NO per-repo overrides, resolved by lib/git/dep-policy.ts against
 * the repo's local checkout. Used to prefill the repo form so the user sees
 * what's going to be applied instead of trusting invisible auto-detection.
 */
export const GET = async (req: Request) => {
  try {
    const query = parseQuery(new URL(req.url), repoDetectQuerySchema);
    const hubPath = repoService.expandLocalPath(query.local_path ?? null);
    let policy: ReturnType<typeof depPolicies.resolve> | null = null;
    if (hubPath && fs.existsSync(hubPath)) {
      policy = depPolicies.resolve({ hubPath });
    }
    return NextResponse.json({
      install_command: policy?.command ?? policy?.fallback?.command ?? null,
      sync_paths: depPolicies.resolveSyncGlobs(null).join("\n"),
      shared_dirs: null,
      source: policy?.source ?? "no local checkout",
    });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
