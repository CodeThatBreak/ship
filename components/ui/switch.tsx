"use client";
import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[16px] w-[28px] shrink-0 items-center rounded-full cursor-pointer transition-colors duration-150",
        "bg-panel-3 border border-border data-[state=checked]:bg-accent data-[state=checked]:border-accent",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-[11px] rounded-full bg-text-dim transition-transform duration-150 translate-x-[2px]",
          "data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-white"
        )}
      />
    </SwitchPrimitive.Root>
  );
}
