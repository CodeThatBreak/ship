/** Local DevFlow API session — generated per process, sent on mutating /api calls. */
export const LOCAL_API = {
  TOKEN_HEADER: "x-devflow-local-token",
  TOKEN_ENV: "DEVFLOW_LOCAL_API_TOKEN",
} as const;

/** Routes that authenticate with their own signatures (exempt from the local token). */
export const LOCAL_API_EXEMPT_PREFIXES = ["/api/hooks/", "/api/webhooks/"] as const;
