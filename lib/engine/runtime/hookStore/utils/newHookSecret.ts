import crypto from "node:crypto";

/** A `whsec_`-prefixed random secret the standardwebhooks library accepts. */
export const newSecret = (): string =>
  `whsec_${crypto.randomBytes(32).toString("base64")}`;
