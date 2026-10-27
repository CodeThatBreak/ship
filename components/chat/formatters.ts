/**
 * Chat feed formatting helpers, re-exported from lib/format.
 *
 * `lib/format` is one of the verified-pure allowlisted modules
 * (docs/phase0-baseline.md, Dispositions) — safe to import directly; this
 * module stays as the chat feature's formatting seam until its consumers
 * collapse onto `@/lib/format` (Phase 6 checklist).
 */
export {
  fmtCost,
  fmtDuration,
  fmtTokens,
  prettyJson,
  summarizeArgs,
  truncateChars,
} from "../../lib/format";
