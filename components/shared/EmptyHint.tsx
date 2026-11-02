"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Generic empty/pending hint: icon plus one muted line (§2.4). */
export const EmptyHint = ({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("text-center px-5 py-10", className)}>
      {Icon ? <Icon size={32} className="text-muted-foreground mb-3 mx-auto" /> : null}
      <p className="text-muted-foreground max-w-[380px] mx-auto">{children}</p>
    </div>
  );
};
