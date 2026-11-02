"use client";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConnectButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Link2 size={13} /> Connect
    </Button>
  );
}
