"use client";
/** Dropdown option renderer — the label as the heading, the description
 *  below it in gray. */
export function SelectOption({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="grid gap-0.5 whitespace-normal">
      <span className="text-[13px] leading-tight">{label}</span>
      <span className="text-[11px] text-muted-foreground leading-tight">
        {description}
      </span>
    </div>
  );
}
