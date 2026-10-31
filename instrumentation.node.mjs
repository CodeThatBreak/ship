/**
 * Node-only instrumentation bootstrap, loaded by `instrumentation.ts` via a
 * runtime (webpackIgnore'd) import. It must stay a plain `.mjs` file outside
 * the Next bundle: anything webpack compiles into the Edge build of the
 * instrumentation hook would drag Node-only deps (better-sqlite3, SDK) into
 * the middleware graph. Keep this file free of imports from `lib/`/`app/` —
 * those belong to the compiled graph and pull in TypeScript sources Node
 * cannot load directly.
 */
import crypto from "node:crypto";

const TOKEN_ENV = "DEVFLOW_LOCAL_API_TOKEN";

let gitLabWebhookStartupWarned = false;

const logGitLabWebhookStartupWarnings = () => {
  if (gitLabWebhookStartupWarned) return;
  gitLabWebhookStartupWarned = true;

  const secret = process.env.GITLAB_WEBHOOK_SECRET?.trim();
  const allowUnsigned = process.env.GITLAB_WEBHOOK_ALLOW_UNSIGNED === "1";

  if (!secret && !allowUnsigned) {
    console.warn(
      "[devflow] GITLAB_WEBHOOK_SECRET is unset — POST /api/webhooks/gitlab is rejected. " +
        "Set GITLAB_WEBHOOK_SECRET or GITLAB_WEBHOOK_ALLOW_UNSIGNED=1 for unsigned local dev.",
    );
  }
  if (allowUnsigned) {
    console.warn(
      "[devflow] GITLAB_WEBHOOK_ALLOW_UNSIGNED=1 — accepting unsigned GitLab webhook deliveries.",
    );
  }
};

const ensureLocalApiToken = () => {
  const fromEnv = process.env[TOKEN_ENV]?.trim();
  if (fromEnv) return;
  process.env[TOKEN_ENV] = crypto.randomBytes(32).toString("hex");
};

/** Node-only instrumentation bootstrap (loaded outside the Edge/middleware graph). */
export const registerNode = async () => {
  ensureLocalApiToken();
  logGitLabWebhookStartupWarnings();
};
