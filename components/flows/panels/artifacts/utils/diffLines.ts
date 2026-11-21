import type { DiffFile, DiffLine, DiffLineType } from "../types/diffLine";

const DIFF_META_LINE = /^(index|new file|deleted file|similarity|rename|old mode|new mode|---|\+\+\+)/;
const DIFF_FILE_HEADER = /a\/(.+?) b\/(.+)/;

/** Split a unified diff into one parsed line sequence per file. */
export function splitFiles(raw: string): DiffFile[] {
  const chunks = raw.split(/^diff --git /m).filter(Boolean);
  return chunks.map((chunk) => {
    const head = chunk.split("\n", 1)[0];
    const match = head.match(DIFF_FILE_HEADER);
    const lines: DiffLine[] = [];
    for (const line of chunk.split("\n").slice(1)) {
      if (DIFF_META_LINE.test(line)) continue;
      if (line.startsWith("@@")) lines.push({ text: line, type: "hunk" });
      else if (line.startsWith("+")) lines.push({ text: line, type: "add" });
      else if (line.startsWith("-")) lines.push({ text: line, type: "del" });
      else if (line.startsWith("\\")) continue;
      else lines.push({ text: line, type: "ctx" });
    }
    return { name: match ? match[2] : head, lines };
  });
}

/** Build the old/new text the diff viewer compares from one file's lines. */
export function toOldNew(lines: DiffLine[]): { oldValue: string; newValue: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of lines) {
    if (line.type === "add") newLines.push(line.text.slice(1));
    else if (line.type === "del") oldLines.push(line.text.slice(1));
    else {
      oldLines.push(line.text.startsWith(" ") ? line.text.slice(1) : line.text);
      newLines.push(line.text.startsWith(" ") ? line.text.slice(1) : line.text);
    }
  }
  return { oldValue: oldLines.join("\n"), newValue: newLines.join("\n") };
}

/** How many lines of one kind a file has — the per-file +/- badges. */
export function countLines(file: DiffFile, type: DiffLineType): number {
  return file.lines.filter((line) => line.type === type).length;
}
