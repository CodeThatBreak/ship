"use client";
/**
 * Shared icon resolution for template editor surfaces (step list, builder
 * canvas). The node_templates `icon` column stores lucide names — the component
 * set lives in WorkflowGraph so the runtime graph and the builder always agree.
 */
import { CircleDot, type LucideIcon } from "lucide-react";
import { ICONS } from "@/components/flows";

/** Resolve the lucide component for a node_templates icon name, falling back
 *  to the declarative kind, then the catalog key, then CircleDot. */
export function iconForIconName(
  iconName: string | null | undefined,
  kind?: string | null,
  catalogKey?: string | null,
): LucideIcon {
  if (iconName && ICONS[iconName]) return ICONS[iconName];
  const k = kind ?? "";
  return ICONS[k] ?? ICONS[`builtin/${k}`] ?? ICONS[catalogKey ?? ""] ?? CircleDot;
}
