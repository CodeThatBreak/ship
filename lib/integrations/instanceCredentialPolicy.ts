import "server-only";

/**
 * When changing an instance base URL, callers must supply fresh credentials —
 * never pair a stored token with a new host (CR-002).
 */
export const baseUrlOverrideRequiresToken = (
  storedBaseUrl: string,
  requestedBaseUrl: string | undefined,
  requestedToken: string | undefined,
): boolean => {
  const next = requestedBaseUrl?.trim().replace(/\/+$/, "");
  if (!next) return false;
  const stored = storedBaseUrl.trim().replace(/\/+$/, "");
  if (next === stored) return false;
  return !requestedToken?.trim();
};

export const normalizeBaseUrlPath = (raw: string): string => raw.trim().replace(/\/+$/, "");
