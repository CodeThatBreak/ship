"use client";

import type { ReactNode } from "react";

import { setClientLocalApiToken } from "@/hooks/local-api-token";

type LocalApiProviderProps = {
  token: string;
  children: ReactNode;
};

/** Injects the per-process local API token for browser `fetch` calls. */
export const LocalApiProvider = ({ token, children }: LocalApiProviderProps) => {
  setClientLocalApiToken(token);
  return children;
};
