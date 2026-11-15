import "server-only";

import type { PrismaClient } from "@prisma/client";
import { RowGateway } from "../db/rows";
import {
  EventStore,
  GitLabInstanceStore,
  JiraInstanceStore,
  MessageStore,
  RepoStore,
  SettingsStore,
} from "../db/stores/storeExports";

/**
 * Composition root (decision Q9 — lands incrementally through step 09).
 *
 * Request-scoped, cheap, stateless: every service is constructor-injected
 * here, holding only its dependencies — all truth lives in Postgres
 * (Invariant 2), so two instances can never disagree. Routes, loaders and
 * server components migrate to `createContainer(prisma)` as their step
 * touches them; the legacy `processSingleton` call sites shrink per the
 * `tests/architecture/noProcessSingletonOutsideDb.test.ts` inventory.
 *
 * The DB client is the ONLY singleton (`lib/db/prismaClient.ts`).
 */
export const createContainer = (prisma: PrismaClient) => {
  // stores constructed via constructor injection (the wider engine wiring —
  // TransitionAuthority, StageRunner, EffectRegistry — lands in steps 02–07)
  const dbLike = { prisma } as never; // Database facade owns the stores today;
  // step-09 lifts construction here as the singleton inventory shrinks.
  void dbLike;
  return {
    stores: {
      events: EventStore,
      gitlabInstances: GitLabInstanceStore,
      jiraInstances: JiraInstanceStore,
      messages: MessageStore,
      repos: RepoStore,
      settings: SettingsStore,
    },
    rows: RowGateway,
    prisma,
  };
};

export type Container = ReturnType<typeof createContainer>;
