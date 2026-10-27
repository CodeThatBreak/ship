import type { ReactNode } from "react";

/**
 * One labeled list section: the small uppercase header row (icon + title +
 * optional count) over the section body. The optional `meta` slot carries a
 * quiet inline indicator (e.g. a refetch spinner) next to the count.
 */
export function ListSection({
  icon,
  label,
  count,
  meta,
  children,
}: {
  icon: ReactNode;
  label: string;
  /** the list's row count — omitted/empty renders no counter chip */
  count?: number | null;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
        {icon} {label}
        {count != null && count > 0 && (
          <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
            {count}
          </span>
        )}
        {meta}
      </h2>
      {children}
    </section>
  );
}
