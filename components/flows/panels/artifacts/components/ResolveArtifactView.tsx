"use client";
import { Markdown } from "@/components/shared/Markdown";
import { PlainArtifact } from "./PlainArtifact";
import { DecisionRow } from "./DecisionRow";
import type { ArtifactPayload } from "../types/artifactPayload";
import { parseResolvePayload } from "../utils/resolvePayload";

/**
 * The `resolve` artifact renderer (task 19): the resolve run's summary and
 * the per-comment decision ledger (fixed / answered / wontfix / skipped,
 * with the posted reply and the internal note) — so a declarative resolve
 * node's panel renders the ledger via the registry, not just the built-in
 * `resolve` def. Presentational only (AGENTS §2.2): the loaded artifact in,
 * JSX out. A non-ledger body renders plain.
 */
export const ResolveArtifactView = ({ artifact }: { artifact: ArtifactPayload }) => {
  const payload = parseResolvePayload(artifact.meta);
  if (!payload) {
    return <PlainArtifact content={artifact.content} />;
  }
  return (
    <div>
      {payload.summary && (
        <div className="text-[13px] [&_p]:my-1.5">
          <Markdown className="text-[13px]">{payload.summary}</Markdown>
        </div>
      )}
      {payload.decisions.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold mb-2">Comment decisions</h3>
          <div className="grid gap-1.5">
            {payload.decisions.map((d) => (
              <DecisionRow key={d.id} decision={d} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};