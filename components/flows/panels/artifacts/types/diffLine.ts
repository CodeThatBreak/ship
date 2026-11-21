/** What a line in a parsed unified diff represents. */
export type DiffLineType = "add" | "del" | "hunk" | "ctx";

/** One line of a parsed unified diff. */
export type DiffLine = { text: string; type: DiffLineType };

/** One file's parsed diff, ready for the side-by-side viewer. */
export type DiffFile = { name: string; lines: DiffLine[] };
