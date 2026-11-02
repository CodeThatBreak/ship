"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FLOW_STATUS } from "@/constants/flow";

export const VersionTabs = ({
  arts,
  sel,
  onSel,
  className,
  captions,
}: {
  arts: { id: string; version: number; status: string }[];
  sel?: string;
  onSel: (id: string) => void;
  className?: string;
  captions?: Map<string, string>;
}) => (
  <div className={cn("flex gap-1.5 flex-wrap", className)}>
    {arts.map((a) => {
      const caption = captions?.get(a.id);
      return (
        <Button
          key={a.id}
          size="sm"
          variant={sel === a.id ? "default" : "outline"}
          className={cn(
            "whitespace-nowrap",
            caption && "h-auto flex-col items-center gap-0 px-2.5 py-1",
          )}
          onClick={() => onSel(a.id)}
        >
          <span>
            v{a.version}
            {a.status === FLOW_STATUS.APPROVED ? " ✓" : ""}
          </span>
          {caption && (
            <span
              className={cn(
                "text-[10px] leading-tight max-w-40 truncate",
                sel === a.id ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {caption}
            </span>
          )}
        </Button>
      );
    })}
  </div>
);
