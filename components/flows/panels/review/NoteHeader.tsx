import { User, FileCode2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ThreadNote } from "./buildThreads";

export const NoteHeader = ({
  note,
  isRoot,
  resolvable,
}: {
  note: ThreadNote;
  isRoot?: boolean;
  resolvable?: boolean;
}) => (
  <div className="flex gap-2 items-center text-xs mb-1.5 flex-wrap">
    <span className="inline-flex items-center gap-[5px] font-semibold">
      <User size={12} className="text-muted-foreground" /> {note.author}
    </span>
    {note.path && (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-[11px] font-mono">
        <FileCode2 size={11} />
        {note.path}
        {note.line ? `:${note.line}` : ""}
      </span>
    )}
    <div className="flex-1" />
    {resolvable === false && isRoot && <Badge>note</Badge>}
    {isRoot && resolvable !== false && (
      <Badge
        className={
          note.status === "resolved"
            ? "bg-success/10 text-success"
            : "bg-warning/10 text-warning"
        }
      >
        {note.status}
      </Badge>
    )}
  </div>
);
