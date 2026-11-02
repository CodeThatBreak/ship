"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper over the shadcn Dialog that keeps the legacy Modal API
 * (`open`, `onClose`, `title`, `className`, `children`, `footer`).
 */
export const Modal = ({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0 w-full max-w-[720px] max-h-[85vh] mx-4",
          "bg-card border-border rounded-lg shadow-2xl sm:max-w-[720px]",
          className,
        )}
      >
        {title ? (
          <DialogHeader className="flex-row items-center justify-between px-5 py-3.5 border-b border-border shrink-0 space-y-0">
            <DialogTitle className="text-[15px] font-medium">{title}</DialogTitle>
            <DialogDescription className="sr-only">Dialog — {title}</DialogDescription>
          </DialogHeader>
        ) : (
          <DialogTitle className="sr-only">Dialog</DialogTitle>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-5 py-4">{children}</div>
        </div>
        {footer ? (
          <DialogFooter className="px-5 py-3.5 border-t border-border bg-card rounded-b-[14px] shrink-0">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
