import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const alertVariants = cva(
  "flex items-center gap-2.5 rounded-[10px] px-3.5 py-3 text-[13px] border",
  {
    variants: {
      variant: {
        default: "border-border",
        amber: "border-amber/45 bg-amber-soft",
        red: "border-red/45 bg-red-soft text-[#f3b6bd]",
        green: "border-green/45 bg-green-soft",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { alertVariants };
