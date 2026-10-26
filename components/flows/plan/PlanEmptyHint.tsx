"use client";
import { Compass } from "lucide-react";

/** Pending plan state: the plan prompt preview lives over the chat panel. */
export function PlanEmptyHint() {
  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <div className="text-center px-5">
        <Compass size={32} className="text-muted-foreground mb-3 mx-auto" />
        <p className="text-muted-foreground max-w-[380px] mx-auto">
          The plan prompt is ready as a preview box over the chat panel —
          review or edit it there to generate an implementation plan from
          the task PRD, Figma links, and the repository.
        </p>
      </div>
    </div>
  );
}
