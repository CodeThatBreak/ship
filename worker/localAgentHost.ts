import { config } from "@/lib/config";
import { db } from "@/lib/db/app";
import { LocalAgentRunner } from "@/lib/integrations/localAgent/localAgentRunner";
import type {
  HostOutbound,
  HostRequest,
  HostStreamEvent,
  HostStreamResult,
} from "@/lib/integrations/localAgent/host/protocol";

/**
 * The local-agent host process.
 *
 * Owns every local agent run for this deployment, and exists for ONE reason:
 * `@cursor/sdk`'s local runtime builds each shell's environment from its own
 * `process.env` (`{...process.env, …requestScopedEnv}`) and offers no per-run
 * override, so wherever the agent loop runs decides what a developer's git
 * hooks and package installs see. In the Next server that means
 * `NODE_ENV=production` — which makes a repo's own validation hooks take their
 * CI branch, find no diff base, check nothing, and exit 0 (a lint gate that
 * passes everything), and makes `npm ci`/`yarn` omit devDependencies.
 *
 * Boot order matters and is the subtle part of this file:
 *   1. The parent spawns us with its FULL env.
 *   2. We resolve config — `lib/config.ts` derives the database URL and the
 *      at-rest key from NODE_ENV, so resolving under a different mode than the
 *      server would attach this process to a different database.
 *   3. Only then do we pin the resolved database URL and drop the marker, so
 *      every shell spawned afterwards sees no NODE_ENV while every config read
 *      still agrees with the server.
 *
 * Must never: expose a network listener, serve a request from anything but its
 * parent (`process.send` is undefined without an IPC channel — we exit), or run
 * engine/db-truth work — it drives agent runs and nothing else.
 */

// 1–2. Resolve the NODE_ENV-dependent config exactly as the server did. The db
// handle is constructed here, which resolves the URL (prisma client) and the
// at-rest key (Database constructor) inside this process.
void db;

// 3. Pin what NODE_ENV decided, then remove the marker for the shells we spawn.
// Without the pin, a later `config.db.url()` would fall through to the dev
// default the moment the marker disappears (production leaves DATABASE_URL
// unset and relies on the NODE_ENV branch). `Reflect.deleteProperty` because
// Next's global augmentation declares `NODE_ENV` readonly on ProcessEnv.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = config.db.url();
Reflect.deleteProperty(process.env, "NODE_ENV");

const runner = new LocalAgentRunner();

const send = (message: HostOutbound): void => {
  process.send?.(message);
};

const emit = (id: number, event: HostStreamEvent): void => {
  send({ type: "event", id, event });
};

const handle = async (request: HostRequest): Promise<unknown> => {
  switch (request.method) {
    case "start":
      return runner.createRun(request.params);
    case "stream": {
      const out = await runner.streamRun(request.params.runId, {
        onStatus: (status) => emit(request.id, { kind: "status", status }),
        onAssistant: (text) => emit(request.id, { kind: "assistant", text }),
        onThinking: (text) => emit(request.id, { kind: "thinking", text }),
        onTool: (name, status, args, callId, extra) =>
          emit(request.id, {
            kind: "tool",
            name,
            status,
            args,
            callId,
            result: extra?.result,
            truncated: extra?.truncated,
          }),
      });
      const result: HostStreamResult = {
        result: out.result,
        agentId: out.sessionId ?? "",
        usage: out.usage,
      };
      return result;
    }
    case "cancel":
      return runner.cancelRun(request.params.runId);
    case "release":
      runner.releaseRun(request.params.runId);
      return null;
    case "inspect":
      return runner.inspectSession(
        request.params.sessionId,
        request.params.runId,
        request.params.workspace,
      );
    case "catalog":
      return runner.listCatalog();
    case "available":
      return runner.available();
    default:
      throw new Error(`unknown host method: ${String((request as { method?: unknown }).method)}`);
  }
};

if (!process.send) {
  console.error("[local-agent-host] no IPC channel — this process is spawned by DevFlow, not run directly");
  process.exit(1);
}

process.on("message", (message: unknown) => {
  const request = message as HostRequest;
  if (request?.type !== "request") return;
  void handle(request)
    .then((result) => send({ type: "response", id: request.id, ok: true, result }))
    .catch((e: unknown) => {
      send({
        type: "response",
        id: request.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
});

process.on("disconnect", () => {
  // the parent went away — no reason to keep agent runs alive in an orphan
  process.exit(0);
});
