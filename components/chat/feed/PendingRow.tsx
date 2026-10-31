import { LoaderCircleIcon } from "lucide-react";

import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

/** Pending indicator shown while the node's agent owes us a chat reply. */
export default function PendingRow({ nodeLabel }: { nodeLabel: string }) {
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <LoaderCircleIcon className="animate-spin" />
        </TraceIcon>
        <TraceTitle>{nodeLabel || "Agent"} is working…</TraceTitle>
      </TraceLine>
    </Trace>
  );
}
