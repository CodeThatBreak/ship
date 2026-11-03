import "server-only";

import { connection } from "next/server";

import { LocalApiProvider } from "@/components/shared/LocalApiProvider";
import { localApiToken } from "@/lib/localApi/token";

/** Server wrapper — reads the process token and hydrates client fetch auth. */
export const LocalApiShell = async ({ children }: { children: React.ReactNode }) => {
  await connection();
  return <LocalApiProvider token={localApiToken()}>{children}</LocalApiProvider>;
};
