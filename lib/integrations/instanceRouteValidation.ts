import "server-only";

import { NotFoundError } from "../errors";
import { validateInstanceBaseUrl } from "./instanceBaseUrl";

type GitHostLike = {
  instances: () => Promise<{ id: string; baseUrl: string }[]>;
};

export const validateGitHostInstanceBaseUrl = async (
  svc: GitHostLike,
  id: string,
  requestedBaseUrl: string | undefined,
): Promise<string | undefined> => {
  if (!requestedBaseUrl?.trim()) return undefined;
  const existing = (await svc.instances()).find((i) => i.id === id);
  if (!existing) throw new NotFoundError("host instance", id);
  return validateInstanceBaseUrl(requestedBaseUrl);
};

export const validateNewGitHostBaseUrl = async (baseUrl: string): Promise<string> =>
  validateInstanceBaseUrl(baseUrl);

export const validateNewTaskInstanceBaseUrl = async (baseUrl: string): Promise<string> =>
  validateInstanceBaseUrl(baseUrl);

export const validateTaskInstanceBaseUrl = async (
  instances: () => Promise<{ id: string; baseUrl: string }[]>,
  id: string,
  requestedBaseUrl: string | undefined,
): Promise<string | undefined> => {
  if (!requestedBaseUrl?.trim()) return undefined;
  const existing = (await instances()).find((i) => i.id === id);
  if (!existing) throw new NotFoundError("task instance", id);
  return validateInstanceBaseUrl(requestedBaseUrl);
};

export const resolveInstanceTestBaseUrl = async (
  storedBaseUrl: string,
  requestedBaseUrl: string | undefined,
): Promise<string> => validateInstanceBaseUrl(requestedBaseUrl?.trim() || storedBaseUrl);
