/** Section heading shared by the general settings sections. */
export function SectionHeading({ icon, children }: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="text-[13px] m-0 text-muted-foreground uppercase tracking-[1px] flex items-center gap-[7px]">
      {icon} {children}
    </h2>
  );
}
