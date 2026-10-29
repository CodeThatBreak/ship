"use client";

import { cn } from "@/lib/utils";

import type { ChatTabs } from "./types";

/** The main conversation's tab copy (ChatTabs.active = null). */
const MAIN_TAB_LABEL = "Main";

/**
 * The chat feed's thread tabs (the plan node's per-sub-plan-refinement
 * conversations): a compact button strip — Main plus one tab per supplied
 * thread — mirrored on the artifact panel's VersionTabs look. Presentational
 * only: the active thread and its switches come from the `ChatTabs` config
 * built by the feature (the plan's `usePlanComposer`).
 */
export default function ChatThreadTabs({ tabs }: { tabs: ChatTabs }) {
  return (
    <div className="flex shrink-0 gap-1.5 flex-wrap px-1 pb-2">
      <TabButton
        label={MAIN_TAB_LABEL}
        selected={tabs.active === null}
        onSelect={() => tabs.onActive(null)}
      />
      {tabs.items.map((tab) => (
        <TabButton
          key={tab.thread}
          label={tab.label}
          selected={tabs.active === tab.thread}
          onSelect={() => tabs.onActive(tab.thread)}
        />
      ))}
    </div>
  );
}

function TabButton({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] leading-tight whitespace-nowrap transition-colors",
        selected
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  );
}
