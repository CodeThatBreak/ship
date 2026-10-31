"use client";
import { useRef, useState } from "react";
import { Input } from "../../ui/input";
import type { JsonataPathOption } from "../variables";
import {
  PathPopover,
  handlePathPopoverKeyDown,
  matchOptions,
  tokenBefore,
} from "./PathAutocomplete";

export const PathField = ({
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
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const { start, token } = tokenBefore(value, caret ?? value.length);
  const shown = matchOptions(options, token);
  const count = shown.length;
  const panelOpen =
    !dismissed && menuOpen && count > 0 && caret != null && token.length > 0;

  const pick = (path: string) => {
    if (caret == null) {
      onChange(path);
    } else {
      onChange(value.slice(0, start) + path + value.slice(caret));
    }
    setDismissed(false);
    setMenuOpen(false);
    setHighlight(-1);
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
        onFocus={() => {
          setCaret(ref.current?.selectionStart ?? value.length);
        }}
        onBlur={() => {
          setCaret(null);
          setMenuOpen(false);
        }}
        onClick={() => setCaret(ref.current?.selectionStart ?? value.length)}
        onChange={(e) => {
          onChange(e.target.value);
          const nextCaret = e.target.selectionStart ?? e.target.value.length;
          setCaret(nextCaret);
          setDismissed(false);
          const { token: nextToken } = tokenBefore(e.target.value, nextCaret);
          setMenuOpen(nextToken.length > 0);
          setHighlight(-1);
        }}
        onKeyDown={(e) =>
          handlePathPopoverKeyDown({
            e,
            count,
            highlight,
            setHighlight,
            shown,
            onPick: pick,
            onDismiss: () => {
              setDismissed(true);
              setMenuOpen(false);
            },
            menuOpen: panelOpen || menuOpen,
            setMenuOpen,
          })
        }
      />
      {panelOpen && (
        <PathPopover
          options={options}
          token={token}
          anchor={ref.current}
          highlight={highlight}
          setHighlight={setHighlight}
          onPick={pick}
        />
      )}
    </div>
  );
};
