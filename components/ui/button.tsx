import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[9px] text-[13px] font-medium font-sans transition-all duration-150 cursor-pointer border border-border bg-panel-2 text-text hover:border-accent hover:bg-panel-3 hover:-translate-y-px active:translate-y-0 disabled:opacity-45 disabled:cursor-not-allowed disabled:transform-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "",
        primary:
          "bg-gradient-to-br from-[#5b8def] to-[#4a76d8] border-transparent text-white shadow-[0_2px_10px_rgba(91,141,239,0.35)] hover:shadow-[0_4px_16px_rgba(91,141,239,0.5)] hover:border-transparent",
        success:
          "bg-gradient-to-br from-[#3fb68b] to-[#2ea377] border-transparent text-white shadow-[0_2px_10px_rgba(63,182,139,0.3)] hover:shadow-[0_4px_16px_rgba(63,182,139,0.45)] hover:border-transparent",
        ghost: "bg-transparent",
        dangerGhost: "text-red",
      },
      size: {
        default: "px-3.5 py-2",
        sm: "px-2.5 py-[5px] text-xs rounded-[7px]",
        icon: "p-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
