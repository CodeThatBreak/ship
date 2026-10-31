"use client";

import { useQuery } from "@tanstack/react-query";
import { artifactQueryOptions } from "../queries";

/** One artifact row — immutable once written, shared across panels and plan UI. */
export const useArtifact = (id: string) => useQuery(artifactQueryOptions(id));
