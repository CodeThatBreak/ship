import "server-only";

import { ValidationError } from "../errors";
import { assertIntegrationBaseUrl, SsrfError } from "../net/ssrf-guard";
import { baseUrlOverrideRequiresToken } from "./instance-credential-policy";

export const validateInstanceBaseUrl = async (baseUrl: string): Promise<string> => {
  try {
    return await assertIntegrationBaseUrl(baseUrl);
  } catch (e: unknown) {
    const message = e instanceof SsrfError || e instanceof Error ? e.message : String(e);
    throw new ValidationError(message);
  }
};

export const assertInstanceBaseUrlOverride = (
  storedBaseUrl: string,
  requestedBaseUrl: string | undefined,
  requestedToken: string | undefined,
): void => {
  if (baseUrlOverrideRequiresToken(storedBaseUrl, requestedBaseUrl, requestedToken)) {
    throw new ValidationError("token is required when overriding baseUrl");
  }
};
