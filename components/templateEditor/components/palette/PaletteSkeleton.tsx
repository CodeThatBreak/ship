/**
 * The palette's loading skeleton (AGENTS.md §2.8): row-shaped placeholders
 * mirroring the final layout — group title + icon/label/description rows,
 * same paddings as the real entries.
 */
import { Skeleton } from '../../../ui/skeleton';

/** The placeholder sections — same titles as the loaded palette, expected row counts. */
const PALETTE_SKELETON_SECTIONS = [
  { title: "Standard", rows: 4 },
  { title: "New node", rows: 4 },
  { title: "This template", rows: 2 },
] as const;

export function PaletteSkeleton() {
  return (
    <div className="px-2 pt-2" aria-hidden>
      {PALETTE_SKELETON_SECTIONS.map((s) => (
        <div key={s.title} className="px-0.5 pb-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1.5 py-1">{s.title}</div>
          <div className="grid gap-1">
            {Array.from({ length: s.rows }, (_, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                <Skeleton className="size-3.5 rounded shrink-0" />
                <span className="flex-1 min-w-0 grid gap-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-40" />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
