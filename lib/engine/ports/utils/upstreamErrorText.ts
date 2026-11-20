/** Cap for echoing an upstream response body into an error message. */
const MAX_UPSTREAM_BODY_CHARS = 500;

export const truncateUpstreamBody = (body: string): string =>
  body.length <= MAX_UPSTREAM_BODY_CHARS ? body : `${body.slice(0, MAX_UPSTREAM_BODY_CHARS)}…`;

export const redactSecretsInText = (text: string, secrets: readonly string[]): string => {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    out = out.split(secret).join("••••");
  }
  return out;
};

export const parseRetryAfterMs = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.round(asSeconds * 1000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
};
