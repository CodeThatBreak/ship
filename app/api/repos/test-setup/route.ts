import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { repoTestSetupBodySchema } from "@/lib/schemas/repo";
import { config } from "../../../../lib/config";
import type { RepoDepOverrides } from "../../../../lib/git/depPolicy";
import { worktreeSetup } from "../../../../lib/git/worktreeSetup";
import type { WorktreeSetupProbeResult } from "../../../../lib/git/worktreeSetup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/repos/test-setup — probe the worktree setup END-TO-END against the
 * local checkout: a REAL throwaway worktree is created, the repo's full setup
 * pipeline (config sync, warm caches, dep strategy, setup command) actually
 * RUNS in it, and the worktree + branch are removed again afterwards.
 */
export const POST = async (req: Request) => {
  let body;
  try {
    body = await parseJson(req, repoTestSetupBodySchema);
  } catch (e: unknown) {
    return toErrorResponse(e);
  }

  const overrides: RepoDepOverrides = {
    install_command: body.install_command,
    skip_install: Boolean(body.skip_install),
    setup_command: body.setup_command,
    sync_paths: body.sync_paths,
    shared_dirs: body.shared_dirs,
  };
  const base = body.default_branch ?? undefined;
  const hubPath = body.local_path;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          /* client disconnected */
        }
      };
      void (async () => {
        try {
          const result = await worktreeSetup.probe({
            hubPath,
            overrides,
            base,
            baseDir: config.workspace.dir(),
            addTimeoutMs: body.worktree_timeout_s ?? undefined,
            onEvent: (message) => send({ type: "event", message }),
          });
          send({ type: "result", result });
        } catch (e: unknown) {
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
};
