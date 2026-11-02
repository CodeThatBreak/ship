import "server-only";

import { z } from "zod";

const declarativeNodeKinds = ["agent", "decision", "http", "script"] as const;

export const nodeTemplateCreateBodySchema = z.object({
  key: z.string().optional(),
  name: z.string().optional(),
  kind: z.enum(declarativeNodeKinds).optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type NodeTemplateCreateBody = z.infer<typeof nodeTemplateCreateBodySchema>;

export const nodeTemplatePatchBodySchema = z.object({
  add_to_library: z.boolean().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type NodeTemplatePatchBody = z.infer<typeof nodeTemplatePatchBodySchema>;
