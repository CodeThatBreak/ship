"use client";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type HostingOption = { value: string; label: string };

/** Module-level option lists (hoisted by callers) stay referentially stable. */
export function HostingSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly HostingOption[];
}) {
  return (
    <Select value={value || null} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Cloud or self-hosted?" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
