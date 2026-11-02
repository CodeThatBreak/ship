"use client";
import { Badge } from "@/components/ui/badge";
import { statusBadgeClass } from "./constants";

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge className={statusBadgeClass(status)}>{status || "—"}</Badge>
);
