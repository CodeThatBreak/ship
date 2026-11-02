import { cn } from "@/lib/utils";
import { FLOW_STATUS } from "@/constants/flow";

/** The running dot in the Flow column (active flows pulse). */
export const FlowStatusDot = ({ status }: { status: string }) => (
  <span
    className={cn(
      "size-2 shrink-0 rounded-full",
      status === FLOW_STATUS.ACTIVE
        ? "bg-success shadow-[0_0_8px] shadow-success/60 animate-pulse"
        : "bg-zinc-600",
    )}
  />
);
