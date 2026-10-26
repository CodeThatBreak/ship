import { NextResponse } from "next/server";
import path from "path";
import { config } from "../../../../lib/config";
import type { RepoDepOverrides } from "../../../../lib/git/dep-policy";
import { worktreeSetup } from "../../../../lib/git/worktree-setup";
import type { WorktreeSetupProbeResult } from "../../../../lib/git/worktree-setup";

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

/** Optional worktree timeout in SECONDS (form unit) → ms; invalid/absent → null. */
function optTimeoutMs(v: unknown): number | null {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

/**
 * POST /api/repos/test-setup — probe the worktree setup END-TO-END against the
 * local checkout: a REAL throwaway worktree is created, the repo's full setup
 * pipeline (config sync, warm caches, dep strategy, setup command) actually
 * RUNS in it, and the worktree + branch are removed again afterwards.
 *
 * STREAMED: every setup step is sent as it happens (NDJSON lines
 * `{"type":"event","message":…}`), with the full probe result as the final
 * line (`{"type":"result",…}`) — the form shows live progress instead of
 * waiting silent minutes for the first install.
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
  const base = optString(body.default_branch) ?? undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    // start() returns synchronously — the probe runs in a detached async task
    // below. If start() itself awaited the probe, the stream would hold every
    // chunk until the whole probe finished and nothing would stream live.
    start(controller) {
      const send = (payload: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          /* the client walked away — the probe finishes and cleans up anyway */
        }
      };
      void (async () => {
        try {
          const result = await worktreeSetup.probe({
            hubPath: expandLocalPath(localPath),
            overrides,
            base,
            baseDir: config.workspace.dir(),
            addTimeoutMs: optTimeoutMs(body.worktree_timeout_s) ?? undefined,
            onEvent: (message) => send({ type: "event", message }),
          });
          send({ type: "result", result });
        } catch (e: unknown) {
          // the probe resolves its own failures as results — a throw here means
          // the stream broke; still close the stream with an honest failure
          const msg = e instanceof Error ? e.message : String(e);
          const result: WorktreeSetupProbeResult = { ok: false, error: msg, actions: [], durationMs: 0 };
          send({ type: "result", result });
        } finally {
          controller.close();
        }
      })();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
