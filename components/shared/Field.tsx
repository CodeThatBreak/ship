"use client";
import { Label } from "@/components/ui/label";

/**
 * Generic form field wrapper: a Label above arbitrary input content.
 * Domain-neutral (no feature types, no API calls) so any feature can use it.
 */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
