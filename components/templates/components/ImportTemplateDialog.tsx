"use client";
/**
 * The gallery's Import-YAML dialog: a file (upload or drag-drop) or paste,
 * validation problems rendered inside the dialog, next to the YAML they
 * point at (A4), an explicit Cancel (A5). The YAML draft + in-dialog error
 * live in the container (`ImportDraft` — the dialog unmounts between opens,
 * and the paste box must survive like the original page state did); the
 * dialog owns the busy state and the import itself, invalidates the gallery
 * list, and hands the created id back to the container (which navigates).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/constants/query-keys";
import { postJson } from "@/hooks/fetch-json";
import { cn } from "@/lib/utils";

/** The import draft the container keeps alive across dialog opens. */
export type ImportDraft = {
  yaml: string;
  /** validation problem / transport error, shown next to the YAML (A4) */
  error: string | null;
};

/** A picked/dropped file's text lands in the paste box (editable after). */
const readImportFile = (
  file: File,
  onDraftChange: (patch: Partial<ImportDraft>) => void,
) => {
  file
    .text()
    .then((text) => onDraftChange({ yaml: text, error: null }))
    .catch(() => onDraftChange({ error: `Could not read ${file.name}.` }));
};

export function ImportTemplateDialog({
  open,
  draft,
  onDraftChange,
  onClose,
  onImported,
}: {
  open: boolean;
  draft: ImportDraft;
  onDraftChange: (patch: Partial<ImportDraft>) => void;
  onClose: () => void;
  /** success callback — the created template's id (the container opens it) */
  onImported: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const importMutation = useMutation({
    mutationFn: (yaml: string) =>
      postJson<{ id: string }>("/api/templates/import", JSON.stringify({ yaml })),
    onSuccess: ({ id }) => {
      onDraftChange({ yaml: "", error: null });
      onClose();
      onImported(id);
    },
    // A4: validation problems stay inside the dialog, next to the YAML they
    // point at — not as a page-top alert
    onError: (e) => onDraftChange({ error: e.message }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.templatesGallery }),
  });

  const cancel = () => {
    // Cancel/Esc clears only the in-dialog error — the YAML draft survives
    // a close, as the original page state did
    onDraftChange({ error: null });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) cancel(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Import template YAML</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <p className="text-[12px] text-muted-foreground m-0">
            The config-as-code shape: name / trigger / nodes (key, type, trigger, config) / edges.
          </p>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) readImportFile(file, onDraftChange);
            }}
            className="grid gap-2 rounded-lg border border-dashed border-border p-3"
          >
            <div className="flex items-center gap-2">
              <label
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}
                title="Load a YAML file into the box below"
              >
                <Upload size={12} /> Choose a file…
                <input
                  type="file"
                  accept=".yaml,.yml,.json,text/yaml,application/x-yaml,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) readImportFile(file, onDraftChange);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <span className="text-[11.5px] text-muted-foreground">or drop a .yaml file here, or paste below</span>
            </div>
            <Textarea value={draft.yaml} onChange={(e) => onDraftChange({ yaml: e.target.value })} rows={14} className="font-mono text-[12px]" placeholder={"name: My flow\ntype: manual\nnodes:\n  - key: plan\n    type: builtin/plan\n    trigger:\n      type: manual\nedges:\n  - [plan, build]"} />
          </div>
          {draft.error && <Alert variant="destructive">{draft.error}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button
            onClick={() => draft.yaml.trim() && importMutation.mutate(draft.yaml)}
            disabled={importMutation.isPending || !draft.yaml.trim()}
          >
            {importMutation.isPending ? <Spinner /> : <Upload size={13} />} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
