"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PANEL_TABS_LIST_CLASS } from "../../../constants/tabs";

type PanelTab<T extends string> = {
  value: T;
  label: string;
  icon: LucideIcon;
};

/** The shared line-variant tab strip for built-in node panels. */
export function PanelTabs<T extends string>({
  activeTab,
  onTabChange,
  ariaLabel,
  tabs,
  children,
}: {
  activeTab: T;
  onTabChange: (tab: T) => void;
  ariaLabel: string;
  tabs: readonly PanelTab<T>[];
  children: ReactNode;
}) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const tab = tabs.find((candidate) => candidate.value === value);
        if (tab) onTabChange(tab.value);
      }}
      className="gap-0"
    >
      <TabsList variant="line" aria-label={ariaLabel} className={PANEL_TABS_LIST_CLASS}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger key={tab.value} value={tab.value}>
              <Icon />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {children}
    </Tabs>
  );
}
