import type { MrComment } from "../../hooks/useFlowComments";

export type ThreadNote = MrComment;

export type ReviewThread = {
  id: string;
  root: ThreadNote;
  replies: ThreadNote[];
  /** root thread participates in the resolve loop (only resolvable roots count as "open") */
  resolvable: boolean;
  /** thread-level open = root is open (and, for counting, resolvable) */
  open: boolean;
  resolved: boolean;
};

/** Group flat comments into discussion threads (root = earliest note). */
export const buildThreads = (comments: MrComment[]): ReviewThread[] => {
  const byThread = new Map<string, ThreadNote[]>();
  for (const c of comments) {
    const key = c.threadId ?? `ind_${c.id}`;
    const arr = byThread.get(key);
    if (arr) arr.push(c);
    else byThread.set(key, [c]);
  }
  const threads: ReviewThread[] = [];
  for (const [id, notes] of byThread) {
    notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const root = notes[0];
    const replies = notes.slice(1);
    const open = root.status === "open";
    threads.push({
      id,
      root,
      replies,
      resolvable: root.resolvable,
      open,
      resolved: !open,
    });
  }
  threads.sort((a, b) => b.root.createdAt.localeCompare(a.root.createdAt));
  return threads;
};
