import * as React from "react"
import { cn } from "cn"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex select-none items-center gap-2 text-[12px] font-medium leading-none text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
