import { CornerDownRight, User } from "lucide-react";
import { Markdown } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReviewThread } from "./buildThreads";
import { NoteHeader } from "./NoteHeader";

export const ThreadCard = ({ thread }: { thread: ReviewThread }) => {
  const { root, replies } = thread;
  return (
    <Card className={cn("p-3.5", !thread.open && thread.resolvable && "opacity-60")}>
      <NoteHeader note={root} isRoot resolvable={thread.resolvable} />
      <div className="text-[13px] [&_p]:my-1.5">
        <Markdown className="text-[13px]">{root.body}</Markdown>
      </div>

      {replies.length > 0 && (
        <div className="mt-2.5 grid gap-2 border-l-2 border-border pl-3.5">
          {replies.map((r) => (
            <div key={r.id} className="pt-1">
              <div className="flex gap-2 items-center text-xs mb-1">
                <CornerDownRight size={12} className="text-muted-foreground shrink-0" />
                <span className="inline-flex items-center gap-[5px] font-semibold">
                  <User size={11} className="text-muted-foreground" /> {r.author}
                </span>
                {r.resolved && <Badge className="bg-success/10 text-success">resolved</Badge>}
              </div>
              <div className="text-[12.5px] [&_p]:my-1 text-muted-foreground">
                <Markdown className="text-[12.5px]">{r.body}</Markdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
