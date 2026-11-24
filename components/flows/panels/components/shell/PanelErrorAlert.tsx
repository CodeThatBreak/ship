'use client';
import { useState } from 'react';
import { AlertTriangle, Check, Copy, RotateCcw, X } from 'lucide-react';
import { Alert, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/hooks/useCopy';

export type PanelErrorDetails = {
  /** short caption above the log, e.g. "Failed at git push, 2 min ago" */
  label: string;
  /** the raw, copyable transcript — rendered monospaced inside the details box */
  content: string;
};

/**
 * The panel's destructive error notice: a title, a plain-language description,
 * an optional collapsible raw-log block with a copy button, and the Retry /
 * dismiss actions pinned to the top-right. `pointer-events-auto` keeps the
 * alert clickable if it is placed inside a click-through notice overlay.
 */
export function PanelErrorAlert({
  title,
  description,
  details,
  onRetry,
  onDismiss,
  retryPending = false,
}: {
  title: string;
  description: string;
  details?: PanelErrorDetails;
  onRetry?: () => void;
  onDismiss?: () => void;
  retryPending?: boolean;
}) {
  // the reference design shows the transcript open (hence "Hide details")
  const [showDetails, setShowDetails] = useState(true);
  const { copied, copy } = useCopy();

  return (
    <Alert
      variant="destructive"
      className="pointer-events-auto gap-3 border-l-4 border-l-destructive bg-destructive/5 py-3.5 shadow-lg has-data-[slot=alert-action]:pr-24 mb-6"
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{description}</p>

          {details && (
            <>
              <button
                type="button"
                aria-expanded={showDetails}
                className="mt-2.5 p-0 text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setShowDetails(open => !open)}
              >
                {showDetails ? 'Hide details' : 'Show details'}
              </button>

              {showDetails && (
                <div className="mt-2 overflow-hidden rounded-lg border border-border bg-background/40">
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{details.label}</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="-mr-1.5 text-muted-foreground"
                      onClick={() => void copy(details.content)}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2.5 font-mono text-[12px] leading-relaxed text-muted-foreground">
                    {details.content}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {(onRetry || onDismiss) && (
        <AlertAction className="flex items-center gap-1">
          {onRetry && (
            <Button variant="outline" disabled={retryPending} onClick={onRetry}>
              <RotateCcw size={12} /> Retry
            </Button>
          )}
          {onDismiss && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Dismiss"
              className="text-muted-foreground"
              onClick={onDismiss}
            >
              <X size={14} />
            </Button>
          )}
        </AlertAction>
      )}
    </Alert>
  );
}
