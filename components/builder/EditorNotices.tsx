"use client";
/**
 * The builder's floating alert: one dismissible notice at a time — a save /
 * linter error (destructive) or an action hint ("Node placed — drag from one
 * of its handles…").
 */
import { X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EditorNoticesProps {
  message: string | null;
  isError: boolean;
  onDismiss: () => void;
}

export function EditorNotices({ message, isError, onDismiss }: EditorNoticesProps) {
  if (message == null) return null;
  return (
    <div className="absolute top-16 inset-x-4 z-40 flex justify-center pointer-events-none">
      <Alert
        variant={isError ? "destructive" : "default"}
        className={cn(
          "max-w-[640px] pointer-events-auto shadow-lg",
          isError && "w-auto",
        )}
      >
        <span>{message}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={14} />
        </Button>
      </Alert>
    </div>
  );
}
