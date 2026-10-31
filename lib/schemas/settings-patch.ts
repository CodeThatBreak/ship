import "server-only";

import { z } from "zod";

const secretsPatch = z
  .record(z.string(), z.union([z.string(), z.null()]))
  .optional();

const localAgentPatch = z
  .object({
    force: z.boolean().optional(),
    sandbox: z.boolean().optional(),
    timeout_ms: z.number().finite().min(60_000).optional(),
  })
  .optional();

export const settingsPatchBodySchema = (allowedHarnesses: readonly string[]) =>
  z
    .object({
      cursor_api_key: z.string().optional(),
      default_harness: z.string().min(1).optional(),
      default_execution_mode: z.enum(["cloud", "local"]).optional(),
      default_model: z.string().optional(),
      local_agent: localAgentPatch,
      secrets: secretsPatch,
      http_allowlist: z.array(z.string()).optional(),
    })
    .superRefine((body, ctx) => {
      if (body.default_harness === undefined) return;
      if (!allowedHarnesses.includes(body.default_harness)) {
        ctx.addIssue({
          code: "custom",
          message: `default_harness must be one of: ${allowedHarnesses.join(", ")}`,
          path: ["default_harness"],
        });
      }
    });

export type SettingsPatchBody = z.infer<ReturnType<typeof settingsPatchBodySchema>>;
