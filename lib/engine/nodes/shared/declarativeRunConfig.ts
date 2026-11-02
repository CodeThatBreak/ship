import "server-only";

import { parseDeclarativeConfig } from "../declarativeConfigParser";

export type DeclarativeTemplateKind = "agent" | "decision" | "http" | "script";

/** Validate a declarative node's merged config — loud failure, no catalog fallback. */
export const parseDeclarativeRunConfig = (
  kind: DeclarativeTemplateKind,
  config: Record<string, unknown>,
  label: string,
): Record<string, unknown> => parseDeclarativeConfig(kind, config, label);
