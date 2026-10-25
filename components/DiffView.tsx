"use client";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { FileCode2 } from "lucide-react";
import { Badge } from "./ui/badge";

const styles = {
  variables: {
    dark: {
      diffViewerBackground: "#0d1118",
      diffViewerColor: "#9aa7b8",
      addedBackground: "rgba(63,182,139,0.1)",
      addedColor: "#6ee7b7",
      removedBackground: "rgba(239,91,107,0.1)",
      removedColor: "#fda4af",
      wordAddedBackground: "rgba(63,182,139,0.25)",
      wordRemovedBackground: "rgba(239,91,107,0.25)",
      addedGutterBackground: "rgba(63,182,139,0.15)",
      removedGutterBackground: "rgba(239,91,107,0.15)",
      gutterBackground: "#0d1118",
      gutterBackgroundDark: "#0a0d13",
      highlightBackground: "rgba(91,141,239,0.12)",
      highlightGutterBackground: "rgba(91,141,239,0.15)",
      codeFoldGutterBackground: "#111722",
      codeFoldBackground: "#111722",
      emptyLineBackground: "#0d1118",
      gutterColor: "#64748b",
      addedGutterColor: "#3fb68b",
      removedGutterColor: "#ef5b6b",
      codeFoldContentColor: "#64748b",
      diffViewerTitleBackground: "#151d2a",
      diffViewerTitleColor: "#9aa7b8",
      diffViewerTitleBorderColor: "#1f2a3a",
    },
  },
  line: { fontSize: "12px", lineHeight: "1.5", fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace' },
};

type Line = { text: string; type: "add" | "del" | "hunk" | "ctx" };

function splitFiles(raw: string) {
  const chunks = raw.split(/^diff --git /m).filter(Boolean);
  return chunks.map((c) => {
    const head = c.split("\n", 1)[0];
    const m = head.match(/a\/(.+?) b\/(.+)/);
    const name = m ? m[2] : head;
    const lines: Line[] = [];
    for (const line of c.split("\n").slice(1)) {
      if (/^(index|new file|deleted file|similarity|rename|old mode|new mode|---|\+\+\+)/.test(line)) continue;
      if (line.startsWith("@@")) lines.push({ text: line, type: "hunk" });
      else if (line.startsWith("+")) lines.push({ text: line, type: "add" });
      else if (line.startsWith("-")) lines.push({ text: line, type: "del" });
      else if (line.startsWith("\\")) continue;
      else lines.push({ text: line, type: "ctx" });
    }
    return { name, lines };
  });
}

function toOldNew(lines: Line[]) {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const l of lines) {
    if (l.type === "add") newLines.push(l.text.slice(1));
    else if (l.type === "del") oldLines.push(l.text.slice(1));
    else {
      oldLines.push(l.text.startsWith(" ") ? l.text.slice(1) : l.text);
      newLines.push(l.text.startsWith(" ") ? l.text.slice(1) : l.text);
    }
  }
  return { oldValue: oldLines.join("\n"), newValue: newLines.join("\n") };
}

/** Renders a unified git diff as per-file split diffs with collapsible sections. */
export default function DiffView({ raw }: { raw: string }) {
  if (!raw || raw.startsWith("(diff unavailable")) {
    return <p className="text-muted-foreground">{raw || "No diff."}</p>;
  }
  const files = splitFiles(raw);
  if (!files.length) return <p className="text-muted-foreground">No diff content.</p>;
  const count = (f: (typeof files)[number], t: Line["type"]) => f.lines.filter((l) => l.type === t).length;
  const totalAdd = files.reduce((s, f) => s + count(f, "add"), 0);
  const totalDel = files.reduce((s, f) => s + count(f, "del"), 0);

  return (
    <div className="font-mono text-xs leading-normal">
      <div className="flex items-center gap-2 mb-1 font-sans">
        <Badge>{files.length} file{files.length > 1 ? "s" : ""}</Badge>
        <Badge className="bg-success/10 text-success">+{totalAdd}</Badge>
        <Badge variant="destructive">−{totalDel}</Badge>
      </div>
      {files.map((f) => {
        const { oldValue, newValue } = toOldNew(f.lines);
        return (
          <details key={f.name} open={files.length <= 5} className="group mt-3">
            <summary className="cursor-pointer list-none flex items-center gap-2 font-sans font-semibold bg-card border border-border rounded-t-[9px] group-open:rounded-b-none group-not-open:rounded-[9px] px-3 py-2">
              <FileCode2 size={14} className="text-muted-foreground" />
              <span className="flex-1">{f.name}</span>
              <span className="text-success font-medium">+{count(f, "add")}</span>
              <span className="text-destructive font-medium">−{count(f, "del")}</span>
            </summary>
            <div className="border border-border border-t-0 rounded-b-[9px] overflow-x-auto bg-background group-not-open:hidden">
              <ReactDiffViewer
                oldValue={oldValue}
                newValue={newValue}
                splitView={false}
                compareMethod={DiffMethod.LINES}
                useDarkTheme
                styles={styles}
                hideLineNumbers={false}
                showDiffOnly={false}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}
