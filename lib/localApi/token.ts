import "server-only";

import crypto from "node:crypto";

import { LOCAL_API } from "../../constants/localApi";

const TOKEN_BYTES = 32;

/**
 * The process's local API token, created lazily on first use and mirrored on
 * `process.env` (middleware reads it there). No `processSingleton` (decision
 * Q9): the env mirror makes repeated creation idempotent even across Next
 * dev's separate module graphs, so a plain module memo is enough.
 */
let cachedToken: string | null = null;

const readOrCreate = (): string => {
  const fromEnv = process.env[LOCAL_API.TOKEN_ENV]?.trim();
  if (fromEnv) {
    cachedToken = fromEnv;
    return fromEnv;
  }
  if (cachedToken) return cachedToken;
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  process.env[LOCAL_API.TOKEN_ENV] = token;
  cachedToken = token;
  return token;
};

/** Ensure the process has a local API token (idempotent). */
export const ensureLocalApiToken = (): void => {
  readOrCreate();
};

export const localApiToken = (): string => readOrCreate();
