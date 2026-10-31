"use client";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWLIST_PLACEHOLDER } from "../constants";
import { useAllowlist } from "../hooks/use-allowlist";

/**
 * The outbound hostname allowlist the SSRF guard enforces (empty = deny-by-
 * default). One hostname per line; saved via the feature's PATCH hook. The
 * parent re-keys this component when the saved list changes, so local edits
 * never desync (AGENTS.md §1.4 — key-reset, no useEffect mirroring).
 */
export function HttpAllowlist({ initial, onError }: {
  initial: string[];
  onError: (e: string | null) => void;
}) {
  const { text, setText, dirty, save, isPending } = useAllowlist(initial);

  return (
    <div>
      <div className="text-[13px] font-medium mb-2">HTTP allowlist</div>
      <Textarea
        rows={3}
        placeholder={ALLOWLIST_PLACEHOLDER}
        className="font-mono text-[12px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-muted-foreground text-[12px] mt-2">
        One hostname per line (subdomains match). Template-authored http nodes may only call these
        hosts — an empty list denies every outbound call.
      </p>
      {dirty && (
        <div className="mt-2.5">
          <Button size="sm" disabled={isPending} onClick={() => save({
            onSuccess: () => onError(null),
            onError: (e) => onError(e.message),
          })}>
            {isPending ? <Spinner /> : <CheckCircle2 size={13} />} Save allowlist
          </Button>
        </div>
      )}
    </div>
  );
}
