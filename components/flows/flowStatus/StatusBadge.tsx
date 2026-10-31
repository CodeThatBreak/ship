import { Badge } from "@/components/ui/badge";
import { statusStyle } from "./statusStyle";

export const StatusBadge = ({ status }: { status: string }) => {
  const { className, label } = statusStyle(status);
  return <Badge className={className}>{status ? label : "—"}</Badge>;
};
