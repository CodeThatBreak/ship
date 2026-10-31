"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QUERY_CLIENT_DEFAULTS } from "@/constants/query-client";

export const AppProviders = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: QUERY_CLIENT_DEFAULTS,
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
