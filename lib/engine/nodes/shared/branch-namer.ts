import "server-only";

import { rejectInvalidBranchNameShape } from "../../../git/branch-name";
import type { FlowCtx } from "./run-context";

/**
 * Git branch naming for builds and fan-out integration branches — built-in
 * bugfix/feature pattern or a template `branch_pattern` knob.
 */
export class BranchNamer {
  builtInBranch(ctx: FlowCtx, suffix?: string): string {
    const slug = String(ctx.task.key ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const type = String(ctx.task.issueType ?? "").toLowerCase();
    const prefix = /story|feature|task|epic/.test(type) ? "feature" : "bugfix";
    const base = `${prefix}/${slug}-${ctx.flow.id.slice(-6)}`;
    return suffix ? `${base}-${suffix}` : base;
  }

  fromPattern(ctx: FlowCtx, pattern: string, suffix?: string): string {
    const slug = String(ctx.task.key ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const type = String(ctx.task.issueType ?? "").toLowerCase();
    const prefix = /story|feature|task|epic/.test(type) ? "feature" : "bugfix";
    return pattern
      .replace(/\{prefix\}/g, prefix)
      .replace(/\{slug\}/g, slug)
      .replace(/\{ticket\}/g, String(ctx.task.key ?? "task"))
      .replace(/\{id\}/g, ctx.flow.id.slice(-6))
      .replace(/\{suffix\}/g, suffix ?? "");
  }

  /** Empty or whitespace pattern → built-in naming. */
  branchName(ctx: FlowCtx, pattern: string | null | undefined, suffix?: string): string {
    const trimmed = pattern?.trim();
    const name = !trimmed ? this.builtInBranch(ctx, suffix) : this.fromPattern(ctx, trimmed, suffix);
    rejectInvalidBranchNameShape(name);
    return name;
  }
}

export const branchNamer = new BranchNamer();
