import "server-only";

import type { SettingSource } from "@cursor/sdk";
import { z } from "zod";
import { ValidationError } from "../../../errors";
import { AGENT_HOST_MESSAGE_KINDS } from "./constants/agentHostMessageKinds";
import type { AgentHostChildMessage, AgentHostParentMessage } from "./types/agentHostProtocol";

// ── payload schemas ─────────────────────────────────────────────────────────

const modelSelectionSchema = z.object({
  id: z.string(),
  params: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
  maxMode: z.boolean().optional(),
});

const settingSourceSchema = z.enum(["project", "user", "team", "mdm", "plugins", "all"] satisfies [
  SettingSource,
  ...SettingSource[],
]);

const agentHostEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), status: z.string() }),
  z.object({ type: z.literal("assistant"), text: z.string() }),
  z.object({ type: z.literal("thinking"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    name: z.string(),
    status: z.string(),
    args: z.unknown().optional(),
    callId: z.string().optional(),
    result: z.unknown().optional(),
    truncated: z.unknown().optional(),
  }),
]);

/**
 * The terminal result the child posts. Deliberately loose: the child posts
 * the SDK's `RunResult` verbatim, and this schema only pins the load-bearing
 * fields the engine consumes (status/result/usage/model/durationMs) — unknown
 * SDK fields pass through untouched instead of drifting out of sync with the
 * SDK's shape.
 */
const runResultSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  result: z.string().optional(),
  durationMs: z.number().optional(),
  model: modelSelectionSchema.nullable().optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      totalTokens: z.number(),
      reasoningTokens: z.number().optional(),
    })
    .nullable()
    .optional(),
});

// ── message schemas ─────────────────────────────────────────────────────────

const startMessageSchema = z.object({
  kind: z.literal(AGENT_HOST_MESSAGE_KINDS.START),
  apiKey: z.string().min(1),
  cwd: z.string().min(1),
  prompt: z.string(),
  mode: z.enum(["agent", "plan"]).optional(),
  name: z.string().optional(),
  model: modelSelectionSchema.optional(),
  sandbox: z.boolean(),
  force: z.boolean(),
  resumeAgentId: z.string().optional(),
  settingSources: z.array(settingSourceSchema).optional(),
});

const parentMessageSchema = z.discriminatedUnion("kind", [
  startMessageSchema,
  z.object({ kind: z.literal(AGENT_HOST_MESSAGE_KINDS.CANCEL) }),
]);

const childMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(AGENT_HOST_MESSAGE_KINDS.STARTED),
    agentId: z.string(),
    runId: z.string(),
  }),
  z.object({
    kind: z.literal(AGENT_HOST_MESSAGE_KINDS.EVENT),
    event: agentHostEventSchema,
  }),
  z.object({
    kind: z.literal(AGENT_HOST_MESSAGE_KINDS.RESULT),
    result: runResultSchema,
  }),
  z.object({
    kind: z.literal(AGENT_HOST_MESSAGE_KINDS.ERROR),
    message: z.string(),
  }),
]);

// ── boundary parsers (§3.4: external input validated at the boundary) ───────

const parseOrThrow = <S extends z.ZodType>(schema: S, raw: unknown, direction: string): unknown => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join(".") || "<root>").join(", ");
    throw new ValidationError(`invalid agent host ${direction} message (${paths})`);
  }
  return parsed.data;
};

/**
 * Parse (and validate) a parent→child message — used by the child entry.
 * The cast is sound: the schema mirrors `AgentHostParentMessage` field for
 * field, so the parsed value is exactly that shape.
 */
export const parseAgentHostParentMessage = (raw: unknown): AgentHostParentMessage =>
  parseOrThrow(parentMessageSchema, raw, "parent-to-child") as AgentHostParentMessage;

/**
 * Parse (and validate) a child→parent message — used by the host. The cast
 * is sound for the same reason, with one nuance on `result`: the child posts
 * the SDK's `RunResult` verbatim, the loose schema pins only the load-bearing
 * fields and passes the rest through, so the parsed object retains the full
 * SDK shape the protocol types declare.
 */
export const parseAgentHostChildMessage = (raw: unknown): AgentHostChildMessage =>
  parseOrThrow(childMessageSchema, raw, "child-to-parent") as AgentHostChildMessage;
