import "server-only";

/** Whether the resolve finalize step should close MR threads (CR-209). */
export const shouldResolveCommentsOnHost = (openCount: number, codeChanged: boolean): boolean =>
  openCount > 0 && codeChanged;

export type HostResolveAttempt = {
  commentId: string;
  ok: boolean;
};

/** Count successes from per-comment host resolve attempts. */
export const countHostResolved = (attempts: HostResolveAttempt[]): number =>
  attempts.filter((a) => a.ok).length;
