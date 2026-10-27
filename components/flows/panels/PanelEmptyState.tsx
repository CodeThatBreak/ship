"use client";
import type { LucideIcon } from "lucide-react";

/** The panels' empty/pending state: a big icon and a single hint line. */
export function PanelEmptyState({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="text-center px-5 py-10">
      <Icon size={32} className="text-muted-foreground mb-3 mx-auto" />
      <p className="text-muted-foreground max-w-[380px] mx-auto">{children}</p>
    </div>
  );
}
