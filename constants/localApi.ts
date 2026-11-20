/** Local DevFlow API session — generated per process, sent on mutating /api calls. */
export const LOCAL_API = {
  TOKEN_HEADER: "x-devflow-local-token",
  TOKEN_ENV: "DEVFLOW_LOCAL_API_TOKEN",
} as const;

/** Routes that authenticate with their own signatures (exempt from the local token). */
export const LOCAL_API_EXEMPT_PREFIXES = ["/api/hooks/", "/api/webhooks/"] as const;

/**
 * Step 08: routes that authenticate with their own per-request credential —
 * NOT the local API token, and deliberately NOT part of the webhook-exempt
 * list above (they are not signature-signed hook receivers). The middleware
 * stands down on these paths and the route itself performs the check: the
 * agent-tools endpoint validates the `Authorization: Bearer` capability
 * token against the attempt's run row (constant-time compare) in the handler.
 */
export const isSelfAuthenticatedApiPath = (pathname: string): boolean =>
  /^\/api\/flows\/[^/]+\/nodes\/[^/]+\/agent-tools$/.test(pathname);
