"use client";
import { Clock } from "lucide-react";
import type { FlowData, Node } from "@/types/flow";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/hooks/localApiToken";

/**
 * The waiting state (§6 node wait_for): the node is eligible but its event
 * source hasn't delivered yet. When the flow carries the node's inbound hook
 * (wait_for webhook), the banner shows the endpoint + secret and a copyable
 * curl example — what was delivered and what resumes the node is never
 * buried in run logs.
 */
export function WaitBanner({ flow, node }: { flow?: FlowData; node: Node }) {
  const hook = (flow?.hooks ?? []).find((h) => h.nodeKey === node.nodeKey);
  const hookPath = hook ? `/api/hooks/${hook.id}` : null;

  const loadSecret = async (): Promise<string | null> => {
    if (!hook) return null;
    const res = await apiFetch(`/api/hooks/${hook.id}/secret`);
    if (!res.ok) return null;
    const body = (await res.json()) as { secret?: string };
    return body.secret ?? null;
  };

  const copyCurl = () => {
    if (!hook || !hookPath) return;
    void (async () => {
      const secret = await loadSecret();
      if (!secret) return;
      const url = `${window.location.origin}${hookPath}`;
      void navigator.clipboard?.writeText(
        `curl -X POST ${url} -H "content-type: application/json" -H "webhook-id: demo-delivery-1" -H "webhook-timestamp: $(date +%s)" -H "x-devflow-secret: ${secret}" -d '{"ping":true}'`,
      );
    })();
  };

  return (
    <Alert className="mb-3.5">
      <Clock size={16} className="shrink-0" />
      <span className="flex-1 text-[12.5px] text-muted-foreground">
        Waiting for its event source — it resumes automatically on delivery.
        {hook && hookPath && (
          <>
            <br />
            POST to <code className="font-mono text-foreground">{hookPath}</code>
            {" "}· secret <code className="font-mono text-foreground">{hook.secret}</code>
          </>
        )}
      </span>
      {hook && hookPath && (
        <Button size="sm" variant="ghost" onClick={copyCurl}>
          Copy curl example
        </Button>
      )}
    </Alert>
  );
}
