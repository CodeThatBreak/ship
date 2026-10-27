import Link from "next/link";
import { Blocks, Plus, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** The gallery's page header: title left, the three actions right (the
 *  "New template" one shows its in-flight state inline). */
export function GalleryHeader({
  busyCreate,
  onImportClick,
  onCreateClick,
}: {
  busyCreate: boolean;
  onImportClick: () => void;
  onCreateClick: () => void;
}) {
  return (
    <header className="flex items-end justify-between gap-4 mb-7">
      <div>
        <h1 className="text-lg font-semibold tracking-tight m-0">Templates</h1>
        <p className="text-muted-foreground text-[12.5px] mt-1 mb-0">Flow templates compose built-in and your own nodes. Edit here or ship YAML.</p>
      </div>
      <div className="flex gap-2">
        <Link href="/templates/nodes" className={cn(buttonVariants({ variant: "outline" }))}>
          <Blocks size={13} /> Template nodes
        </Link>
        <Button variant="outline" onClick={onImportClick}>
          <Upload size={13} /> Import YAML
        </Button>
        <Button onClick={onCreateClick} disabled={busyCreate}>
          {busyCreate ? <Spinner /> : <Plus size={13} />} New template
        </Button>
      </div>
    </header>
  );
}
