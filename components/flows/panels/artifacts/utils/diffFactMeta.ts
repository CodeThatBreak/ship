import type { ArtifactPayload } from "../types/artifactPayload";
import {
  DIFF_ALT_PROJECTION,
  DIFF_ATTRIBUTION,
  DIFF_FACT_META,
  type DiffAttribution,
} from "../constants/diffFactMeta";

/** The diff fact's meta as the renderer reads it (Task 08). */
export interface DiffFactMetaView {
  branch: string;
  /** which projection the artifact content carries */
  attribution: DiffAttribution;
  baseSha: string | null;
  /** the branch head at capture — the staleness anchor the refresh bumps */
  headSha: string | null;
  /** the worktree-only variant: the agent left its changes uncommitted */
  uncommitted: boolean;
  /** the other projection when both are computable — null otherwise */
  alt: { attribution: DiffAttribution; stat: string; raw: string } | null;
}

/**
 * Narrow the artifact meta into the diff-fact view. Null when the artifact
 * carries no diff meta at all (the pre-Task-08 shape renders as-is — a plain
 * whole-branch diff, no toggle, no banner), or when the branch key is
 * missing/unreadable: missing data fails loudly at the top instead of
 * half-rendering (AGENTS §2.9).
 */
export const diffFactMetaOf = (artifact: ArtifactPayload): DiffFactMetaView | null => {
  const meta = artifact.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const branch = meta[DIFF_FACT_META.BRANCH];
  if (typeof branch !== "string" || !branch) return null;
  const attributionRaw = meta[DIFF_FACT_META.ATTRIBUTION];
  const attribution: DiffAttribution =
    attributionRaw === DIFF_ATTRIBUTION.AGENT ? DIFF_ATTRIBUTION.AGENT : DIFF_ATTRIBUTION.ALL;
  return {
    branch,
    attribution,
    baseSha: stringValue(meta[DIFF_FACT_META.BASE_SHA]),
    headSha: stringValue(meta[DIFF_FACT_META.HEAD_SHA]),
    uncommitted: meta[DIFF_FACT_META.UNCOMMITTED] === true,
    alt: altProjectionOf(meta[DIFF_FACT_META.ALT]),
  };
};

/** The raw string a meta key holds, null for anything else. */
const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

/** The alternate projection when its shape reads back whole; null otherwise. */
const altProjectionOf = (value: unknown): DiffFactMetaView["alt"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const attributionRaw = (value as Record<string, unknown>)[DIFF_ALT_PROJECTION.ATTRIBUTION];
  if (attributionRaw !== DIFF_ATTRIBUTION.AGENT && attributionRaw !== DIFF_ATTRIBUTION.ALL) return null;
  const raw = (value as Record<string, unknown>)[DIFF_ALT_PROJECTION.RAW];
  if (typeof raw !== "string" || !raw) return null;
  const stat = (value as Record<string, unknown>)[DIFF_ALT_PROJECTION.STAT];
  return { attribution: attributionRaw, raw, stat: typeof stat === "string" ? stat : "" };
};