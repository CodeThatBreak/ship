"use client";
import { Label } from "@/components/ui/label";

/**
 * Generic form field wrapper: a Label above arbitrary input content, with an
 * optional one-line help text between them.
 * Domain-neutral (no feature types, no API calls) so any feature can use it.
 */
export function Field({
  label, help, children,
}: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {help && <p className="text-muted-foreground text-[11.5px] leading-snug">{help}</p>}
      {children}
    </div>
  );
}
