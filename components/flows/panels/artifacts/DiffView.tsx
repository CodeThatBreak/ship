"use client";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { FileCode2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DIFF_VIEW_STYLES } from "./constants/diffStyles";
import type { ArtifactPayload } from "./types/artifactPayload";
import { countLines, splitFiles, toOldNew } from "./utils/diffLines";

/** Renders a unified git diff as per-file split diffs with collapsible sections. */
export const DiffView = ({ artifact }: { artifact: ArtifactPayload }) => {
  const raw = artifact.content;
  if (!raw || raw.startsWith("(diff unavailable")) {
    return <p className="text-muted-foreground">{raw || "No diff."}</p>;
  }
  const files = splitFiles(raw);
  if (!files.length) return <p className="text-muted-foreground">No diff content.</p>;
  const totalAdd = files.reduce((sum, file) => sum + countLines(file, "add"), 0);
  const totalDel = files.reduce((sum, file) => sum + countLines(file, "del"), 0);

  return (
    <div className="font-mono text-xs leading-normal">
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
