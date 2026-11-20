import "server-only";

import { z } from "zod";

/** trigger input / published output — validated against the contract in run() */
export const StartPayload = z.record(z.string(), z.unknown());
export type StartPayload = z.infer<typeof StartPayload>;
