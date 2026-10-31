import "server-only";

import crypto from "node:crypto";

import { LOCAL_API } from "../../constants/local-api";
import { processSingleton } from "../singleton";

const TOKEN_BYTES = 32;

const readOrCreate = (): string => {
  const fromEnv = process.env[LOCAL_API.TOKEN_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  process.env[LOCAL_API.TOKEN_ENV] = token;
  return token;
};

/** One process-wide local API token (also mirrored on `process.env` for middleware). */
export const ensureLocalApiToken = (): void => {
  processSingleton("local-api-token", readOrCreate);
};

export const localApiToken = (): string =>
  processSingleton("local-api-token", readOrCreate);
