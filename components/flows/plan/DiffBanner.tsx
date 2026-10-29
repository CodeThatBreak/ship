"use client";
import { useState } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight } from "lucide-react";
import type { WholePlanDiff, WholeStep } from "./branch-diff";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/** One expandable old-vs-new row of the banner (added | removed | changed). */
type DiffRowKind = "added" | "removed" | "changed";

const ROW_TITLED = (n: number) => `${n} step${n > 1 ? "s" : ""} changed`;

const summaryOf = (info: WholePlanDiff): string => {
  const { diff } = info;
  const branches: string[] = [];
  const addBranch = (b?: string) => {
    if (b && !branches.includes(b)) branches.push(b);
  };
  for (const s of [...diff.added, ...diff.removed]) addBranch(s.branch);
  for (const c of diff.changed) addBranch(c.after.branch ?? c.before.branch);

  const parts = [
    diff.changed.length ? ROW_TITLED(diff.changed.length) : null,
    diff.added.length ? `${diff.added.length} added` : null,
    diff.removed.length ? `${diff.removed.length} removed` : null,
  ].filter(Boolean);
  const suffix =
    branches.length > 0 ? ` (branch: ${branches.join(", ")})` : "";
  return `${parts.join(", ")}${suffix}`;
};

/** The kind chip's color per row kind (palette-consistent with the branch card). */
const ROW_KIND_CLASS: Record<DiffRowKind, string> = {
  added: "text-success",
  removed: "text-destructive",
  changed: "text-warning",
};

/** One old-vs-new row: the step id, the title transition, its branch tag, kind-colored. */
function DiffRow({
  kind,
  id,
  oldTitle,
  newTitle,
  branch,
}: {
  kind: DiffRowKind;
  id: string;
  oldTitle: string;
  newTitle: string;
  branch?: string;
}) {
  const titles =
    kind === "added"
      ? newTitle
      : kind === "removed"
        ? oldTitle
        : `${oldTitle} → ${newTitle}`;
  return (
    <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground min-w-0">
      <span className="font-mono text-[10.5px] shrink-0 w-14 text-right">
        <span className={ROW_KIND_CLASS[kind]}>{kind}</span>
      </span>
      <span className="truncate">
        <span className="font-mono text-[10.5px]">{id}</span>: {titles}
      </span>
      {branch && (
        <span className="font-mono text-[10px] shrink-0 text-muted-foreground/80">
          branch: {branch}
        </span>
      )}
    </p>
  );
}

/**
 * The whole-plan refine diff banner (§6a): a collapsed one-line summary of
 * what the newest version changed against the previous one, expandable into
 * the old-vs-new step rows with their branch annotations. Pure
 * presentational — the data comes from `computeWholePlanDiff` (branch-diff.ts),
 * no fetching, no domain logic in the tree.
 */
export function DiffBanner({ info }: { info: WholePlanDiff }) {
  const [open, setOpen] = useState(false);
  const rowBranch = (s: WholeStep) => s.branch;
  return (
    <Card className="px-3.5 py-2.5 gap-0">
      <button
        className="w-full flex items-center gap-2 text-left min-w-0"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={13} className="text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-muted-foreground shrink-0" />
        )}
        <Badge className="bg-warning/10 text-warning shrink-0">
          <ArrowRightLeft size={10} /> refined v{info.fromVersion} → v
          {info.toVersion}
        </Badge>
        <span className="text-[11.5px] text-muted-foreground truncate">
          v{info.toVersion} — {summaryOf(info)}
        </span>
      </button>
      {open && (
        <div className="mt-2 pt-1.5 border-t border-border flex flex-col gap-1">
          {info.diff.changed.map((c) => (
            <DiffRow
              key={c.id}
              kind="changed"
              id={c.id}
              oldTitle={c.before.title}
              newTitle={c.after.title}
              branch={rowBranch(c.after) ?? rowBranch(c.before)}
            />
          ))}
          {info.diff.added.map((s) => (
            <DiffRow
              key={`added:${s.id}`}
              kind="added"
              id={s.id}
              oldTitle={s.title}
              newTitle={s.title}
              branch={rowBranch(s)}
            />
          ))}
          {info.diff.removed.map((s) => (
            <DiffRow
              key={`removed:${s.id}`}
              kind="removed"
              id={s.id}
              oldTitle={s.title}
              newTitle={s.title}
              branch={rowBranch(s)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
