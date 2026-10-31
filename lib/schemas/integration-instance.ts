import "server-only";

import { z } from "zod";

const hasBaseUrl = (body: { baseUrl?: string; base_url?: string }): boolean =>
  Boolean((body.baseUrl ?? body.base_url ?? "").trim());

export const gitHostInstanceCreateBodySchema = z
  .object({
    name: z.string().nullable().optional(),
    baseUrl: z.string().optional(),
    base_url: z.string().optional(),
    token: z.string().min(1),
  })
  .refine(hasBaseUrl, { message: "baseUrl and token are required", path: ["baseUrl"] })
  .transform((body) => ({
    name: body.name ?? null,
    baseUrl: (body.baseUrl ?? body.base_url ?? "").trim(),
    token: body.token,
  }));

export type GitHostInstanceCreateBody = z.infer<typeof gitHostInstanceCreateBodySchema>;

export const gitHostInstancePatchBodySchema = z.object({
  name: z.string().nullable().optional(),
  baseUrl: z.string().min(1).optional(),
  base_url: z.string().min(1).optional(),
  token: z.string().optional(),
});

export const gitHostInstanceTestBodySchema = z.object({
  baseUrl: z.string().optional(),
  base_url: z.string().optional(),
  token: z.string().optional(),
});

export const taskInstanceCreateBodySchema = z
  .object({
    name: z.string().nullable().optional(),
    baseUrl: z.string().optional(),
    base_url: z.string().optional(),
    email: z.string().min(1),
    token: z.string().min(1),
  })
  .refine(hasBaseUrl, { message: "baseUrl and token are required", path: ["baseUrl"] })
  .transform((body) => ({
    name: body.name ?? null,
    baseUrl: (body.baseUrl ?? body.base_url ?? "").trim(),
    email: body.email.trim(),
    token: body.token,
  }));

export type TaskInstanceCreateBody = z.infer<typeof taskInstanceCreateBodySchema>;

export const taskInstancePatchBodySchema = z.object({
  name: z.string().nullable().optional(),
  baseUrl: z.string().min(1).optional(),
  base_url: z.string().min(1).optional(),
  email: z.string().optional(),
  token: z.string().optional(),
});

export const taskInstanceTestBodySchema = z.object({
  baseUrl: z.string().optional(),
  base_url: z.string().optional(),
  email: z.string().optional(),
  token: z.string().optional(),
});
