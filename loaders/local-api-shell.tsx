import "server-only";

import { LocalApiProvider } from "@/components/shared";
import { localApiToken } from "@/lib/local-api/token";

/** Server wrapper — reads the process token and hydrates client fetch auth. */
export const LocalApiShell = ({ children }: { children: React.ReactNode }) => (
  <LocalApiProvider token={localApiToken()}>{children}</LocalApiProvider>
);
