import "server-only";

/** GitLab HTTPS git operations accept Basic auth with user `oauth2` and the PAT as password. */
export const gitLabOAuthBasicHeaderEnv = (token: string): Record<string, string> => {
  const header = `Authorization: Basic ${Buffer.from(`oauth2:${token}`).toString("base64")}`;
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: header,
  };
};
