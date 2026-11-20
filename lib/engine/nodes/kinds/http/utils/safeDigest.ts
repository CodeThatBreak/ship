import "server-only";

import { allowlistResponseHeaders, capSerializedPayload } from "../../../shared/payloadDigest";

/** Artifact digest capping oversized bodies (headers + a body summary). */
export const safeDigest = (o: Record<string, unknown>): Record<string, unknown> => {
  return {
    status: o.status,
    ok: o.ok,
    body: capSerializedPayload(o.body),
    headers: allowlistResponseHeaders(o.headers as Record<string, string> | undefined),
  };
};
