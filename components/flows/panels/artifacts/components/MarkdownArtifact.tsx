"use client";
import { Markdown } from "@/components/shared/Markdown";
import type { ArtifactPayload } from "../types/artifactPayload";

/** The markdown artifact body — the renderer AgentView uses for its output. */
export const MarkdownArtifact = ({ artifact }: { artifact: ArtifactPayload }) => (
  <Markdown className="text-[13px] [&>*:first-child]:mt-0">{artifact.content}</Markdown>
);
