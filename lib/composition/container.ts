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
import { NodeSupport } from "../engine/nodes/shared/nodeSupport";
import { NodeStore } from "../engine/runtime/nodeStore";
import { NodeAttemptRegistry } from "../engine/runtime/nodeAttemptRegistry";
import { ContractPipeline } from "../engine/runtime/contractPipeline";
import { TransitionAuthority } from "../engine/runtime/transitions/nodeTransitions";
import { TransitionEvents } from "../engine/runtime/transitions/transitionEvents";

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
    engine: engineParts,
  };
};

export type Container = ReturnType<typeof createContainer>;

/** The engine-cluster parts (step 02+): the transition authority's collaborators. */
export interface EngineParts {
  nodeSupport: NodeSupport;
  nodeStore: NodeStore;
  attemptRegistry: NodeAttemptRegistry;
  contracts: ContractPipeline;
  transitions: TransitionAuthority;
  events: TransitionEvents;
}

/**
 * The engine wiring (step 02, decision Q9): one place constructs
 * `NodeSupport`, `NodeStore`, `NodeAttemptRegistry` and the
 * `TransitionAuthority` — the former module/process singletons become
 * constructor-injected from here.
 *
 * The shared `engineParts` instance is deliberately NOT process-pinned:
 * every part is stateless or DB-fenced, so per-module-graph copies cannot
 * disagree (the authority's writes are conditional UPDATEs against the same
 * rows). The one in-memory map — the attempt registry — no longer carries
 * a liveness role (step 03 replaced it with durable leases); it is a
 * per-process cache of currently-held attempt tokens only. Modules not yet
 * container-owned (node-kind helpers) import `engineParts` until their step
 * rewires them.
 */
export const createEngineParts = (): EngineParts => {
  const nodeStore = new NodeStore();
  const attemptRegistry = new NodeAttemptRegistry();
  const events = new TransitionEvents();
  const contracts = new ContractPipeline();
  const transitions = new TransitionAuthority(attemptRegistry, events, contracts);
  const nodeSupport = new NodeSupport(transitions);
  return { nodeSupport, nodeStore, attemptRegistry, contracts, transitions, events };
};

export const engineParts = createEngineParts();

/**
 * The shared `NodeSupport` instance — node-kind helpers import it directly
 * until their step threads construction through the container (steps 05+).
 */
export const nodeSupport = engineParts.nodeSupport;

