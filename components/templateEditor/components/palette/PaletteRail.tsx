/**
 * The palette's collapsed rail: a slim strip with the restore button.
 */
import { Button } from '../../../ui/button';
import { PanelLeftOpen } from "lucide-react";

export function PaletteRail({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="w-11 shrink-0 border-r border-border bg-card flex flex-col items-center py-3">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground"
        onClick={onOpen}
        title="Show the node palette"
      >
        <PanelLeftOpen size={16} />
      </Button>
      <div className="text-[9.5px] font-medium text-muted-foreground mt-1.5 [writing-mode:vertical-rl] tracking-wider">
        NODES
      </div>
    </div>
  );
}
