import "server-only";

import { LocalApiProvider } from "@/components/shared/LocalApiProvider";
import { localApiToken } from "@/lib/localApi/token";

/** Server wrapper — reads the process token and hydrates client fetch auth. */
export const LocalApiShell = ({ children }: { children: React.ReactNode }) => (
  <LocalApiProvider token={localApiToken()}>{children}</LocalApiProvider>
);
