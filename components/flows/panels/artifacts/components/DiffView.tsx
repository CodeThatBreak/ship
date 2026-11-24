"use client";
import { useState } from "react";
import { DIFF_ATTRIBUTION, type DiffAttribution } from "../constants/diffFactMeta";
import type { ArtifactPayload } from "../types/artifactPayload";
import type { PanelActionFn } from "../types/artifactRenderer";
import { diffFactMetaOf } from "../utils/diffFactMeta";
import { DiffBody } from "./DiffBody";

/**
 * Renders a unified git diff as per-file split diffs with collapsible
 * sections. Task 08: a diff fact that carries the attribution meta renders
 * the "Agent only / Whole branch" toggle when both projections are
 * computable (`meta.alt`), the uncommitted banner ("not yet on a branch")
 * for the worktree-only variant, and — when the artifact detail's read-only
 * staleness read reports the branch moved past the capture — the stale badge
 * plus the refresh action, fired through the panel's typed action
 * dispatcher (never a direct fetch: presentational per AGENTS §2.2). A
 * pre-Task-08 artifact (no meta) renders exactly as before.
 */
export const DiffView = ({ artifact, action }: { artifact: ArtifactPayload; action?: PanelActionFn }) => {
  const meta = diffFactMetaOf(artifact);
  // the toggle's selection — null until the user picks, then pinned
  const [selected, setSelected] = useState<DiffAttribution | null>(null);
  const active: DiffAttribution = selected ?? meta?.attribution ?? DIFF_ATTRIBUTION.ALL;
  const body = !meta
    ? artifact.content
    : active === meta.attribution
      ? artifact.content
      : (meta.alt?.raw ?? artifact.content);

  return <DiffBody artifact={artifact} body={body} meta={meta} active={active} onSelect={setSelected} action={action} />;
};
