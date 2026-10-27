/**
 * A copyable curl that triggers the template's webhook flow — the inbound
 * hook's endpoint + the shared-secret header the route accepts
 * (`app/api/hooks/[id]`), with the copy button carrying the real secret. The
 * secret is masked on screen though (same posture as MaskedSecret): the card
 * already shows it behind the eye toggle, but the curl text itself shouldn't
 * print it.
 */
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../ui/button";
import { useCopy } from "../../hooks/use-copy";

export function HookCurlExample({
  hook,
}: {
  hook: { id: string; secret: string };
}) {
  const { copied, copy } = useCopy();
  // the page origin — browser-only state read after mount (hydration safe;
  // this drawer body never renders on the server)
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const curlText = `curl -X POST ${origin}/api/hooks/${hook.id} -H "content-type: application/json" -H "x-devflow-secret: ${hook.secret}" -d '{"event":"issue.created"}'`;
  const [before, after] = curlText.split(hook.secret);
  return (
    <span className="flex items-start gap-0.5 text-muted-foreground">
      <code
        className="font-mono text-[12px] break-all flex-1 min-w-0"
        title="curl example — copy to hit this hook from your terminal"
      >
        {before}
        <span className="text-muted-foreground/70">••••</span>
        {after}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground shrink-0"
        title="Copy curl"
        onClick={() => void copy(curlText)}
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
