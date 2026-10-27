"use client";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";

/** Empty state for the repo list — mirrors the integrations ConnectEmpty. */
export function ReposEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Database /></EmptyMedia>
        <EmptyTitle>No repos registered yet</EmptyTitle>
        <EmptyDescription>
          Register a cloud URL — and optionally a local checkout — so flows can run against it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus size={13} /> Add repo
        </Button>
      </EmptyContent>
    </Empty>
  );
}
