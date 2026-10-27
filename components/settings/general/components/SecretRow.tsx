"use client";
import { useCallback, useState } from "react";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SECRET_MASK } from "../constants";

/**
 * One set secret: name (values are write-only, so only the mask badge shows)
 * plus an edit action and a two-step inline delete (the trash button flips
 * into Confirm/Cancel before the real delete fires).
 */
export function SecretRow({ name, pending, onEdit, onDelete }: {
  name: string;
  pending?: boolean;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  // stable callbacks built in the row so the list maps primitives only
  const edit = useCallback(() => onEdit(name), [onEdit, name]);
  const del = useCallback(() => onDelete(name), [onDelete, name]);
  const cancel = useCallback(() => setConfirming(false), []);

  return (
    <Card className="flex-row items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <KeyRound size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[13px] truncate leading-tight">{name}</span>
          <Badge variant="outline" className="font-mono text-[10.5px] shrink-0">{SECRET_MASK}</Badge>
        </div>
        <div className="mt-1 text-muted-foreground text-[11.5px] truncate">
          referenced as {`{{secrets.${name}}}`}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {confirming ? (
          <>
            <Button size="xs" variant="destructive" disabled={pending} onClick={del}>
              Confirm
            </Button>
            <Button size="xs" variant="ghost" disabled={pending} onClick={cancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${name}`}
                    disabled={pending}
                    onClick={edit}
                  />
                }
              >
                <Pencil size={14} className="text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>Edit secret</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${name}`}
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    disabled={pending}
                    onClick={() => setConfirming(true)}
                  />
                }
              >
                <Trash2 size={14} />
              </TooltipTrigger>
              <TooltipContent>Delete secret</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </Card>
  );
}
