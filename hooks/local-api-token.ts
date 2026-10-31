import { LOCAL_API } from "@/constants/local-api";

let clientToken = "";

export const setClientLocalApiToken = (token: string): void => {
  clientToken = token.trim();
};

export const localApiAuthHeaders = (): Record<string, string> => {
  if (!clientToken) return {};
  return { [LOCAL_API.TOKEN_HEADER]: clientToken };
};

/** Merge local API auth into fetch init (mutating /api calls from the UI). */
export const withLocalApiAuth = (init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(localApiAuthHeaders())) {
    headers.set(key, value);
  }
  return { ...init, headers };
};

export const apiFetch = (url: string, init?: RequestInit): Promise<Response> =>
  fetch(url, withLocalApiAuth(init));
