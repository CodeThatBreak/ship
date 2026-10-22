"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={cn(
          "bg-panel border border-border rounded-[14px] shadow-2xl w-full max-w-[720px] max-h-[85vh] flex flex-col mx-4",
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-soft shrink-0">
            <h3 className="m-0 text-[15px] font-medium">{title}</h3>
            <button
              onClick={onClose}
              className="text-muted hover:text-text-dim transition-colors cursor-pointer bg-transparent border-none p-1"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
