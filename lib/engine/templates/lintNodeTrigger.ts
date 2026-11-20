import "server-only";

import { NODE_TRIGGER_TYPES, WAIT_FOR_SOURCES } from "../constants/triggers";
import type { LintProblem } from "@/types/templateLint";

/** Validate a node trigger mapping (type + wait_for vocabulary). */
export const lintNodeTrigger = (
  where: string,
  raw: unknown,
  problems: LintProblem[],
  nodeKey: string,
): void => {
  if (raw == null) return;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push({ where, message: "node trigger must be a mapping", nodeKey });
    return;
  }
  const rec = raw as Record<string, unknown>;
  if (rec.type != null) {
    if (typeof rec.type !== "string" || !(NODE_TRIGGER_TYPES as readonly string[]).includes(rec.type)) {
      problems.push({
        where,
        message: `unknown node trigger type "${String(rec.type)}" — use one of: ${NODE_TRIGGER_TYPES.join(", ")}`,
        nodeKey,
      });
    }
  }
  if (rec.waitFor != null) {
    if (typeof rec.waitFor !== "string" || !(WAIT_FOR_SOURCES as readonly string[]).includes(rec.waitFor)) {
      problems.push({
        where,
        message: `unknown wait_for source "${String(rec.waitFor)}" — use one of: ${WAIT_FOR_SOURCES.join(", ")}`,
        nodeKey,
      });
    }
  }
};
