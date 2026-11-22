import "server-only";

import { z } from "zod";

const secretsPatch = z
  .record(z.string(), z.union([z.string(), z.null()]))
  .optional();

const localAgentPatch = z
  .object({
    force: z.boolean().optional(),
    sandbox: z.boolean().optional(),
    timeoutMs: z.number().finite().min(60_000).optional(),
  })
  .optional();

export const settingsPatchBodySchema = (allowedHarnesses: readonly string[]) =>
  z
    .object({
      cursorApiKey: z.string().optional(),
      defaultHarness: z.string().min(1).optional(),
      defaultExecutionMode: z.enum(["cloud", "local"]).optional(),
      defaultModel: z.string().optional(),
      localAgent: localAgentPatch,
      secrets: secretsPatch,
      httpAllowlist: z.array(z.string()).optional(),
    })
    .superRefine((body, ctx) => {
      if (body.defaultHarness === undefined) return;
      if (!allowedHarnesses.includes(body.defaultHarness)) {
        ctx.addIssue({
          code: "custom",
          message: `defaultHarness must be one of: ${allowedHarnesses.join(", ")}`,
          path: ["defaultHarness"],
        });
      }
    });

export type SettingsPatchBody = z.infer<ReturnType<typeof settingsPatchBodySchema>>;
