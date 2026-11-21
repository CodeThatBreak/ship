"use client";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/shared/Markdown";
import { PlainArtifact } from "./components/PlainArtifact";
import { RESOLVE_ACTION_VARIANT } from "./constants/resolveCommentActions";
import type { ArtifactPayload } from "./types/artifactPayload";
import { parseResolvePayload, type ResolveDecisionView } from "./utils/resolvePayload";

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

const DecisionRow = ({ decision }: { decision: ResolveDecisionView }) => (
  <div className="flex gap-2 items-baseline text-[13px] flex-wrap">
    <span className="font-mono text-[11px] text-muted-foreground">{decision.id}</span>
    <Badge className={RESOLVE_ACTION_VARIANT[decision.action] ?? ""}>{decision.action}</Badge>
    {!decision.resolve && <Badge>thread stays open</Badge>}
    {decision.reply && <span className="min-w-0 flex-1 text-muted-foreground">“{decision.reply}”</span>}
    {decision.note && <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">{decision.note}</span>}
  </div>
);