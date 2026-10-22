import * as React from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-panel border border-border-soft rounded-panel shadow-panel",
        className
      )}
      {...props}
    />
  );
}
