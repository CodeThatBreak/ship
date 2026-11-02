import type { RepoRow } from "@/lib/db/rows";

/** Repo registry row as returned by GET /api/repos (timestamps omitted on the wire). */
export type Repo = Omit<RepoRow, "created_at" | "updated_at"> & {
  /** Client-side path probe — not persisted. */
  local_path_exists?: boolean;
};

/** Slice of {@link Repo} the build modal and task workspace need. */
export type RepoSummary = Pick<Repo, "id" | "name" | "cloud_url" | "local_path">;
