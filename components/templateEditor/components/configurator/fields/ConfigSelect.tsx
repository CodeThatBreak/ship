"use client";
/**
 * A select config knob on the shadcn select, extracted from
 * ConfigFieldRow.tsx. Variants:
 *  - rich (options carry descriptions): heading + gray description items, no
 *    "(default)" option — the effective value always resolves to one of the
 *    options (the catalog default shows as its own choice)
 *  - icon: the effective value is always one of the options (no empty item)
 *  - plain: a sentinel item resets to the default.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../ui/select';
import { iconForIconName } from '../../../icons';
import { SelectOption } from "./SelectOption";

/** the plain variant's sentinel value — reset to the catalog/class default */
const DEFAULT_RESET_VALUE = "__default__";

export function ConfigSelect({
  options,
  optionIcons,
  effective,
  defaultValue,
  defaultLabel,
  id,
  onChange,
}: {
  options: { value: string; label: string; description?: string }[];
  optionIcons?: Record<string, string>;
  effective: unknown;
  defaultValue?: unknown;
  defaultLabel: string;
  /** the trigger's DOM id — pairs with the field label's htmlFor */
  id?: string;
  onChange: (v: unknown) => void;
}) {
  const current =
    effective != null && options.some((o) => o.value === String(effective))
      ? String(effective)
      : "";
  const selected = options.find((o) => o.value === current);
  if (options.some((o) => o.description)) {
    const value =
      selected?.value ??
      options.find((o) => o.value === String(defaultValue))?.value ??
      options[0]?.value ??
      "";
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger
          id={id}
          className="w-full rounded-lg border-border bg-card"
        >
          <SelectValue>
            {options.find((o) => o.value === value)?.label ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <SelectOption label={o.label} description={o.description ?? ""} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (optionIcons) {
    // icon variant (agent mode) — the effective value is always one of the options
    const value = current || options[0]?.value || "";
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger
          id={id}
          className="w-full rounded-lg border-border bg-card"
        >
          <SelectValue>{selected?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => {
            const Icon = optionIcons[o.value]
              ? iconForIconName(optionIcons[o.value])
              : null;
            return (
              <SelectItem key={o.value} value={o.value}>
                {Icon && (
                  <Icon size={13} className="text-muted-foreground shrink-0" />
                )}
                {o.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Select
      value={current || DEFAULT_RESET_VALUE}
      onValueChange={(v) => onChange(v === DEFAULT_RESET_VALUE ? undefined : v)}
    >
      <SelectTrigger
        id={id}
        className="w-full rounded-lg border-border bg-card"
      >
        <SelectValue>{selected?.label ?? defaultLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_RESET_VALUE}>{defaultLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
