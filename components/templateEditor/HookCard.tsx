/**
 * The inbound hook card — the template's always-provisioned webhook endpoint:
 * the POST path, the shared secret (masked with reveal/copy) and the curl
 * that triggers the flow. Purely presentational; the settings drawer reads
 * the provisioning state from its parent.
 */
import { Card } from "../ui/card";
import { Webhook as WebhookIcon } from "lucide-react";
import { MaskedSecret } from "./MaskedSecret";
import { HookCurlExample } from "./HookCurlExample";

export function HookCard({ hook }: { hook: { id: string; secret: string } }) {
  return (
    <Card className="p-3 grid gap-1.5 mt-1">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
        <WebhookIcon size={12} /> Inbound hook
      </div>
      <code className="font-mono text-[12px] break-all">
        POST /api/hooks/{hook.id}
      </code>
      <MaskedSecret value={hook.secret} />
      <HookCurlExample hook={hook} />
      <p className="text-[11px] text-muted-foreground m-0">
        Delivery body becomes{" "}
        <code className="font-mono">{"{{trigger.payload}}"}</code> in the
        flow&apos;s context. Save to apply filter changes.
      </p>
    </Card>
  );
}
