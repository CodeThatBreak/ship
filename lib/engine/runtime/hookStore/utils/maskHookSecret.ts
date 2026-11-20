import "server-only";

import { maskToken } from "../../../../maskToken";

/** Masked hook secret for flow snapshots and other client polls (CR-254). */
export const maskHookSecret = (secret: string): string => maskToken(secret);
