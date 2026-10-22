import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-[5px] px-[9px] py-[3px] rounded-full text-[11px] font-medium border whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-border bg-panel-2 text-text-dim",
        green: "text-green border-green/40 bg-green-soft",
        red: "text-red border-red/40 bg-red-soft",
        amber: "text-amber border-amber/40 bg-amber-soft",
        blue: "text-accent border-accent/40 bg-accent-soft",
        purple: "text-purple border-purple/40 bg-purple-soft",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Small colored dot used inside status badges. */
export function BadgeDot({ className }: { className?: string }) {
  return <span className={cn("size-1.5 rounded-full bg-current", className)} />;
}

export { badgeVariants };
