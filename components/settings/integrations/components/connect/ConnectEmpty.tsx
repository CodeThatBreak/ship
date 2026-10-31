"use client";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { ConnectButton } from "./ConnectButton";

export function ConnectEmpty({
  icon, title, description, onConnect,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onConnect: () => void;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ConnectButton onClick={onConnect} />
      </EmptyContent>
    </Empty>
  );
}
