"use client";

import type { ReactNode } from "react";
import { InstanceCardSkeleton } from "./InstanceCard";
import { InstanceListError } from "./InstanceListError";

const DEFAULT_SKELETON_COUNT = 3;

/** Shared pending / error / empty / grid shell for GitTab and TaskTab instance lists. */
export const InstanceList = ({
  isError,
  onRetry,
  isPending,
  isEmpty,
  empty,
  children,
  skeletonCount = DEFAULT_SKELETON_COUNT,
}: {
  isError: boolean;
  onRetry: () => void;
  isPending: boolean;
  isEmpty: boolean;
  empty: ReactNode;
  children: ReactNode;
  skeletonCount?: number;
}) => {
  if (isError) {
    return <InstanceListError onRetry={onRetry} />;
  }

  if (isPending) {
    return (
      <div className="grid gap-2.5">
        {Array.from({ length: skeletonCount }, (_, index) => (
          <InstanceCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (isEmpty) {
    return empty;
  }

  return <div className="grid gap-2.5 content-start">{children}</div>;
};
