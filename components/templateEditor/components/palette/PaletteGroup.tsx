/**
 * A palette section: the uppercase group title over its rows.
 */
export function PaletteGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pb-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1.5 py-1">{title}</div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}
