/**
 * The inbound hook's secret — masked by default (Phase 6): dots until the eye
 * is clicked, with a copy button that never needs the reveal.
 */
import { useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "../ui/button";
import { useCopy } from "../../hooks/useCopy";

export function MaskedSecret({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const { copied, copy } = useCopy();
  return (
    <span className="flex items-center gap-1 font-mono text-[12px] text-muted-foreground break-all">
      <span className="text-muted-foreground/70">secret</span>
      {revealed ? value : "•".repeat(Math.min(value.length || 8, 20))}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        title={revealed ? "Hide secret" : "Reveal secret"}
        onClick={() => setRevealed((v) => !v)}
      >
        {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        title="Copy secret"
        onClick={() => void copy(value)}
      >
        {copied ? (
          <Check size={11} className="text-success" />
        ) : (
          <Copy size={11} />
        )}
      </Button>
    </span>
  );
}
