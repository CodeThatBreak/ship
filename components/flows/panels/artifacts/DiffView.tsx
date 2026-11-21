"use client";
import { useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { FileCode2, GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FLOW_ACTION } from "@/constants/flow";
import { DIFF_ATTRIBUTION, type DiffAttribution } from "./constants/diffFactMeta";
import { DIFF_VIEW_STYLES } from "./constants/diffStyles";
import type { ArtifactPayload } from "./types/artifactPayload";
import type { PanelActionFn } from "./types/artifactRenderer";
import { countLines, splitFiles, toOldNew } from "./utils/diffLines";
import { diffFactMetaOf } from "./utils/diffFactMeta";

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

const DiffBody = ({
  artifact,
  body,
  meta,
  active,
  onSelect,
  action,
}: {
  artifact: ArtifactPayload;
  body: string;
  meta: ReturnType<typeof diffFactMetaOf>;
  active: DiffAttribution;
  onSelect: (a: DiffAttribution) => void;
  action?: PanelActionFn;
}) => {
  if (!body || body.startsWith("(diff unavailable")) {
    return <p className="text-muted-foreground">{body || "No diff."}</p>;
  }
  const files = splitFiles(body);
  if (!files.length) return <p className="text-muted-foreground">No diff content.</p>;
  const totalAdd = files.reduce((sum, file) => sum + countLines(file, "add"), 0);
  const totalDel = files.reduce((sum, file) => sum + countLines(file, "del"), 0);

  return (
    <div className="font-mono text-xs leading-normal">
      {meta?.uncommitted && (
        <Alert variant="default" className="mb-2 font-sans">
          <GitBranch size={14} />
          <span className="flex-1 text-muted-foreground">
            Not yet on a branch — this diff is the agent&apos;s uncommitted worktree changes.
          </span>
        </Alert>
      )}
      {(meta?.alt || artifact.branchHeadStale) && (
        <div className="flex items-center gap-2 mb-1 font-sans flex-wrap">
          {meta?.alt && (
            <div role="group" aria-label="Diff attribution" className="inline-flex rounded-md border border-border overflow-hidden">
              <ToggleOption
                label="Agent only"
                value={DIFF_ATTRIBUTION.AGENT}
                active={active === DIFF_ATTRIBUTION.AGENT}
                onSelect={onSelect}
              />
              <ToggleOption
                label="Whole branch"
                value={DIFF_ATTRIBUTION.ALL}
                active={active === DIFF_ATTRIBUTION.ALL}
                onSelect={onSelect}
              />
            </div>
          )}
          {artifact.branchHeadStale && (
            <Badge className="bg-warning/10 text-warning">Branch updated since capture</Badge>
          )}
          {artifact.branchHeadStale && artifact.id && action && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => action(FLOW_ACTION.REFRESH_DIFF, { artifactId: artifact.id })}
            >
              <RefreshCw size={12} /> Refresh diff
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 mb-1 font-sans">
        <Badge>{files.length} file{files.length > 1 ? "s" : ""}</Badge>
        <Badge className="bg-success/10 text-success">+{totalAdd}</Badge>
        <Badge variant="destructive">−{totalDel}</Badge>
      </div>
      {files.map((file) => {
        const { oldValue, newValue } = toOldNew(file.lines);
        const added = countLines(file, "add");
        const deleted = countLines(file, "del");
        return (
          <details key={file.name} open={files.length <= 5} className="group mt-3">
            <summary className="cursor-pointer list-none flex items-center gap-2 font-sans font-semibold bg-card border border-border rounded-t-[9px] group-open:rounded-b-none group-not-open:rounded-lg px-3 py-2">
              <FileCode2 size={14} className="text-muted-foreground" />
              <span className="flex-1">{file.name}</span>
              <span className="text-success font-medium">+{added}</span>
              <span className="text-destructive font-medium">−{deleted}</span>
            </summary>
            <div className="border border-border border-t-0 rounded-b-[9px] overflow-x-auto bg-background group-not-open:hidden">
              <ReactDiffViewer
                oldValue={oldValue}
                newValue={newValue}
                splitView={false}
                compareMethod={DiffMethod.LINES}
                useDarkTheme
                styles={DIFF_VIEW_STYLES}
                hideLineNumbers={false}
                showDiffOnly={false}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
};

const ToggleOption = ({
  label,
  value,
  active,
  onSelect,
}: {
  label: string;
  value: DiffAttribution;
  active: boolean;
  onSelect: (value: DiffAttribution) => void;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={() => onSelect(value)}
    className={`px-2 py-0.5 text-[11px] font-medium ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
  >
    {label}
  </button>
);