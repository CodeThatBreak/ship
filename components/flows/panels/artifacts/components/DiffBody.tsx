"use client";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { FileCode2, GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FLOW_ACTION } from "@/constants/flow";
import { DIFF_ATTRIBUTION, type DiffAttribution } from "../constants/diffFactMeta";
import { DIFF_VIEW_STYLES } from "../constants/diffStyles";
import type { ArtifactPayload } from "../types/artifactPayload";
import type { PanelActionFn } from "../types/artifactRenderer";
import { countLines, splitFiles, toOldNew } from "../utils/diffLines";
import { diffFactMetaOf } from "../utils/diffFactMeta";
import { ToggleOption } from "./ToggleOption";

/** The rendered diff body: per-file split diffs, attribution toggles and the
 *  stale/refresh affordances (the presentation half of `DiffView`). */
export const DiffBody = ({
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
              <FileCode2 size={14} className="shrink-0 text-muted-foreground" />
              {/* long paths must not push the counts out of the header — the
                  full name stays available on hover (AGENTS §2.9: no overflow) */}
              <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
              <span className="shrink-0 text-success font-medium">+{added}</span>
              <span className="shrink-0 text-destructive font-medium">−{deleted}</span>
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
