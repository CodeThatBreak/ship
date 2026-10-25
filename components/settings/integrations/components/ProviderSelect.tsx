"use client";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type ProviderOption = { value: string; label: string; icon: React.ReactNode };

/** Module-level option lists (hoisted by callers) stay referentially stable. */
export function ProviderSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly ProviderOption[];
}) {
  return (
    <Select value={value || null} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select provider" />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.icon} {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
