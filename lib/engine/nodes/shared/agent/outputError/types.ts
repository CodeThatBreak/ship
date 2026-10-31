import "server-only";

import type { z } from "zod";
import type { AgentOutputErrorCode } from "./constants";
import type {
  AgentOutputErrorDetailSchema,
  AgentOutputIssueSchema,
  AgentReportedErrorSchema,
} from "./schema";

export type AgentOutputIssue = z.infer<typeof AgentOutputIssueSchema>;
export type AgentReportedError = z.infer<typeof AgentReportedErrorSchema>;
export type AgentOutputErrorDetail = z.infer<typeof AgentOutputErrorDetailSchema>;

/** What a consumer passes to `new AgentOutputError(...)`: the failure's raw
 *  ingredients. The class builds the validated `detail` from them — including
 *  excerpting `response` into `detail.response_excerpt` — so callers never
 *  touch the excerpt logic themselves. */
export type AgentOutputErrorInput = {
  code: AgentOutputErrorCode;
  label: string;
  message: string;
  issues: AgentOutputIssue[];
  /** the agent's raw response, untrimmed */
  response: string;
  /** when code = agent_reported: the agent's own self-report, carried verbatim */
  reported?: AgentReportedError;
};
