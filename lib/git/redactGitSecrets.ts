import "server-only";

/** Strip `user:pass@` from https clone/push URLs before logging or persisting errors. */
export const redactUrlUserinfo = (text: string): string =>
  text.replace(/\/\/[^@\s/]+@/g, "//***@");

export const redactGitSecrets = (text: string, secrets: readonly string[] = []): string => {
  let out = redactUrlUserinfo(text);
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    out = out.split(secret).join("••••");
  }
  return out;
};
