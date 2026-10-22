import * as React from "react";
import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full bg-panel-2 text-text border border-border rounded-[9px] px-3 py-[9px] text-[13px] font-sans transition-colors duration-150 resize-y",
        "focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft",
        "placeholder:text-muted",
        className
      )}
      {...props}
    />
  );
}
