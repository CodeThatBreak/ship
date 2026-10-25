"use client";
import type { Harness } from "../../context";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EXECUTION_MODE_META, INTEGRATIONS_HARNESS_HINT, MODE_FALLBACK_ICON } from "../constants";

/**
 * The harness → execution-mode cascade, data-driven from `settings.harnesses`
 * (not hardcoded to cloud/local). First a harness select, then that harness's
 * modes as button chips — a disabled chip means the mode isn't connected yet.
 * Both saves write `default_harness` + `default_execution_mode` together.
 */
export function ModeCascade({ harnesses, selectedKey, savedMode, saving, onSaveHarness, onSaveMode }: {
  harnesses: Harness[];
  selectedKey: string | null;
  savedMode: string;
  /** suppress the chips while a harness/mode PATCH is in flight */
  saving?: boolean;
  onSaveHarness: (key: string) => void;
  onSaveMode: (key: string, value: string) => void;
}) {
  const selected = selectedKey
    ? harnesses.find((h) => h.key === selectedKey) ?? null
    : null;
  const modes = selected?.modes ?? [];
  const configured = modes.filter((m) => m.configured);
  const savedModeOffered = !!savedMode && modes.some((m) => m.value === savedMode);

  return (
    <div>
      <div className="text-[13px] font-medium mb-2">Default harness &amp; mode for new flows</div>

      <Select value={selectedKey} onValueChange={(v) => onSaveHarness(v ?? "")}>
        <SelectTrigger className="max-w-[280px]">
          <SelectValue placeholder="Select harness" />
        </SelectTrigger>
        <SelectContent>
          {harnesses.map((h) => (
            <SelectItem key={h.key} value={h.key}>{h.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected && (
        <div className="flex gap-2 mt-2.5 flex-wrap">
          {modes.map((m) => {
            const Meta = EXECUTION_MODE_META[m.value];
            const Icon = Meta?.icon ?? MODE_FALLBACK_ICON;
            return (
              <Button
                key={m.value}
                size="sm"
                variant={m.configured ? (m.value === savedMode ? "default" : "outline") : "outline"}
                disabled={!m.configured || saving}
                onClick={() => onSaveMode(selected.key, m.value)}
              >
                <Icon size={13} /> {m.label}
              </Button>
            );
          })}
          {!savedModeOffered && configured.length > 0 && (
            <p className="text-muted-foreground text-[12px] w-full">
              The saved mode isn&apos;t offered by this harness — pick one below to fix it.
            </p>
          )}
          {configured.length === 0 && (
            <p className="text-warning text-[12px] w-full">
              No configured modes for {selected.label} — set it up under {INTEGRATIONS_HARNESS_HINT}.
            </p>
          )}
        </div>
      )}

      {!selected && harnesses.length > 0 && (
        <p className="text-muted-foreground text-[12px] mt-2">
          Pick a harness to choose how agents run.
        </p>
      )}

      {harnesses.length === 0 && (
        <p className="text-muted-foreground text-[12px] mt-2">
          No harness options — connect one under {INTEGRATIONS_HARNESS_HINT}.
        </p>
      )}
    </div>
  );
}
