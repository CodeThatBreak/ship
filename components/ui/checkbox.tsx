"use client";
import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export function Checkbox({ className, ...props }: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "size-[15px] shrink-0 rounded-[4px] border border-border bg-panel-2 cursor-pointer transition-colors duration-150",
        "flex items-center justify-center",
        "hover:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft",
        "data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-white",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check size={11} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
