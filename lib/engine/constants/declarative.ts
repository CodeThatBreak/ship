/** Declarative node-kind vocabularies (decision / http / script kinds). The
 *  zod schemas in `nodes/declarative-schemas.ts` consume these and re-export
 *  them, so its public surface is unchanged. */

export const DECISION_SOURCES = ["expression", "manual", "agent"] as const;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

export const SCRIPT_RUNTIMES = ["shell", "node", "python"] as const;
