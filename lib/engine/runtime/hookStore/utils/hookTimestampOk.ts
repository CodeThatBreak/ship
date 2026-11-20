import "server-only";

import { FALLBACK_TIMESTAMP_TOLERANCE_SEC } from "../constants/hookVerification";

/** Unix seconds within the standardwebhooks tolerance window. */
export const fallbackTimestampOk = (raw: string): boolean => {
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - ts) <= FALLBACK_TIMESTAMP_TOLERANCE_SEC;
};
