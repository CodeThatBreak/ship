"use client";
import type { DiffAttribution } from "../constants/diffFactMeta";

/** One agent/whole-branch attribution toggle button. */
export const ToggleOption = ({
  label,
  value,
  active,
  onSelect,
}: {
  label: string;
  value: DiffAttribution;
  active: boolean;
  onSelect: (value: DiffAttribution) => void;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={() => onSelect(value)}
    className={`px-2 py-0.5 text-[11px] font-medium ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
  >
    {label}
  </button>
);
