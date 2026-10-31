/**
 * An edge endpoint picker (the drawer's From/To): labeled with the node's
 * display name, mono font — the values are the nodes' instance keys.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import type { EditorNode } from "../types";
import { nodeLabel } from "../types";

export function EdgeSelect({
  value,
  nodes,
  disabled,
  onChange,
}: {
  value: string;
  nodes: EditorNode[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const selected = nodes.find((n) => n.key === value);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v != null) onChange(v);
      }}
    >
      <SelectTrigger className="w-full rounded-lg border-border bg-card font-mono">
        <SelectValue>{selected ? nodeLabel(selected) : value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {nodes.map((n) => (
          <SelectItem key={n.key} value={n.key} className="font-mono">
            {nodeLabel(n)}
            {n.key !== nodeLabel(n) && (
              <span className="text-muted-foreground"> ({n.key})</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
