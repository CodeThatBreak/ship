import 'server-only';

import path from 'path';
import { z } from 'zod';
import { gitLabRepoCloudUrlSchema } from '../integrations/gitlab/repoUrl';

const homeDir = (): string => process.env.HOME ?? '';

/** Only `~` and `~/…` expand to $HOME; `~user/…` is rejected (CR-167). */
export const isAllowedTildePrefix = (value: string): boolean => {
  if (!value.startsWith('~')) return true;
  return value === '~' || value.startsWith('~/');
};

export const expandRepoLocalPath = (raw: string | null | undefined): string | null => {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!isAllowedTildePrefix(trimmed)) {
    return null;
  }
  if (trimmed === '~') return homeDir();
  if (trimmed.startsWith('~/')) return path.join(homeDir(), trimmed.slice(2));
  return trimmed;
};

const localPathInput = z
  .union([z.string(), z.null()])
  .optional()
  .superRefine((value, ctx) => {
    if (value == null || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!isAllowedTildePrefix(trimmed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'localPath: use ~ or ~/ to refer to your home directory',
        path: [],
      });
    }
  })
  .transform(value => {
    if (value == null || typeof value !== 'string') return value ?? null;
    return expandRepoLocalPath(value);
  });

const optionalEmptyToNull = z
  .string()
  .optional()
  .transform(value => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
  });

const worktreeTimeoutSeconds = z
  .union([z.string(), z.number()])
  .optional()
  .transform(value => {
    if (value === undefined) return undefined;
    const n =
      typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? Math.trunc(value) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    return n * 1000;
  });

const repoWorktreeFields = {
  useWorktrees: z.boolean().optional(),
  installCommand: optionalEmptyToNull,
  skipInstall: z.boolean().optional(),
  syncPaths: optionalEmptyToNull,
  sharedDirs: optionalEmptyToNull,
  setupCommand: optionalEmptyToNull,
  worktreeTimeoutS: worktreeTimeoutSeconds,
};

const cloudUrlInput = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    const parsed = gitLabRepoCloudUrlSchema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message });
      }
    }
  });

export const repoCreateBodySchema = z.object({
  name: z.string().trim().min(1),
  cloudUrl: cloudUrlInput,
  localPath: localPathInput,
  defaultBranch: z.string().trim().min(1).optional(),
  ...repoWorktreeFields,
});

export type RepoCreateBody = z.infer<typeof repoCreateBodySchema>;

const patchOptionalString = z.string().optional();

const patchWorktreeTimeoutSeconds = z
  .union([z.string(), z.number()])
  .optional()
  .transform(value => {
    if (value === undefined) return undefined;
    const n =
      typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? Math.trunc(value) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    return n * 1000;
  });

export const repoPatchBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  cloudUrl: cloudUrlInput.optional(),
  localPath: localPathInput,
  defaultBranch: z.string().trim().min(1).optional(),
  useWorktrees: z.boolean().optional(),
  installCommand: patchOptionalString,
  skipInstall: z.boolean().optional(),
  syncPaths: patchOptionalString,
  sharedDirs: patchOptionalString,
  setupCommand: patchOptionalString,
  worktreeTimeoutS: patchWorktreeTimeoutSeconds,
});

export type RepoPatchBody = z.infer<typeof repoPatchBodySchema>;

const requiredLocalPathInput = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    if (!isAllowedTildePrefix(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'localPath: use ~ or ~/ to refer to your home directory',
        path: [],
      });
    }
  })
  .transform(value => expandRepoLocalPath(value))
  .refine((value): value is string => typeof value === 'string' && value.length > 0, {
    message: 'localPath is required',
  });

export const repoDetectQuerySchema = z.object({
  localPath: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (!isAllowedTildePrefix(trimmed)) {
        ctx.addIssue({
          code: 'custom',
          message: 'localPath: use ~ or ~/ to refer to your home directory',
          path: ['localPath'],
        });
      }
    }),
});

export type RepoDetectQuery = z.infer<typeof repoDetectQuerySchema>;

export const repoTestSetupBodySchema = z.object({
  localPath: requiredLocalPathInput,
  defaultBranch: optionalEmptyToNull,
  ...repoWorktreeFields,
});

export type RepoTestSetupBody = z.infer<typeof repoTestSetupBodySchema>;
