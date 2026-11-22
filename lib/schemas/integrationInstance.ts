import "server-only";

import { z } from "zod";

const httpsBaseUrl = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (url.protocol !== "https:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "baseUrl must use https" });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "baseUrl must be a valid https URL" });
    }
  });

const hasBaseUrl = (body: { baseUrl?: string }): boolean => Boolean((body.baseUrl ?? "").trim());

export const gitHostInstanceCreateBodySchema = z
  .object({
    name: z.string().nullable().optional(),
    baseUrl: httpsBaseUrl.optional(),
    token: z.string().min(1),
  })
  .refine(hasBaseUrl, { message: "baseUrl and token are required", path: ["baseUrl"] })
  .transform((body) => ({
    name: body.name ?? null,
    baseUrl: (body.baseUrl ?? "").trim(),
    token: body.token,
  }));

export type GitHostInstanceCreateBody = z.infer<typeof gitHostInstanceCreateBodySchema>;

export const gitHostInstancePatchBodySchema = z.object({
  name: z.string().nullable().optional(),
  baseUrl: httpsBaseUrl.optional(),
  token: z.string().optional(),
});

export const gitHostInstanceTestBodySchema = z.object({
  baseUrl: httpsBaseUrl.optional(),
  token: z.string().optional(),
});

export const taskInstanceCreateBodySchema = z
  .object({
    name: z.string().nullable().optional(),
    baseUrl: httpsBaseUrl.optional(),
    email: z.string().min(1),
    token: z.string().min(1),
  })
  .refine(hasBaseUrl, { message: "baseUrl and token are required", path: ["baseUrl"] })
  .transform((body) => ({
    name: body.name ?? null,
    baseUrl: (body.baseUrl ?? "").trim(),
    email: body.email.trim(),
    token: body.token,
  }));

export type TaskInstanceCreateBody = z.infer<typeof taskInstanceCreateBodySchema>;

export const taskInstancePatchBodySchema = z.object({
  name: z.string().nullable().optional(),
  baseUrl: httpsBaseUrl.optional(),
  email: z.string().optional(),
  token: z.string().optional(),
});

export const taskInstanceTestBodySchema = z.object({
  baseUrl: httpsBaseUrl.optional(),
  email: z.string().optional(),
  token: z.string().optional(),
});
