"use client";
/**
 * A single-line JSONata path field with autocomplete (the condition rows'
 * `[variable ▾]` — pickable from the vocabulary, freely typable beyond it).
 */
import { useRef, useState } from "react";
import { Input } from "../../ui/input";
import type { JsonataPathOption } from "../variables";
import { PathPopover, tokenBefore } from "./PathAutocomplete";

export function PathField({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  options: JsonataPathOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { start, token } = tokenBefore(value, caret ?? value.length);
  const pick = (path: string) => {
    if (caret == null) {
      onChange(path);
    } else {
      onChange(value.slice(0, start) + path + value.slice(caret));
    }
    setDismissed(false);
    requestAnimationFrame(() => ref.current?.focus());
  };
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={ref}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className="font-mono text-[12px] min-w-0"
        onFocus={(e) => {
          setCaret(e.target.selectionStart ?? value.length);
          setDismissed(false);
        }}
        onBlur={() => setCaret(null)}
        onClick={(e) =>
          setCaret(e.currentTarget.selectionStart ?? value.length)
        }
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissed(false);
        }}
      />
      {caret != null && !dismissed && options.length > 0 && (
        <PathPopover
          options={options}
          token={token}
          anchor={ref.current}
          onPick={pick}
          onDismiss={() => setDismissed(true)}
        />
      )}
    </div>
  );
}
