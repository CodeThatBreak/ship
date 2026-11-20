import "server-only";

import type { NodeDefinition } from "../shared/nodeDefinition";

/** Declarative template resolver: hydrate a def from its `node_templates` row. */
type DeclarativeResolver = (key: string, inst?: string) => Promise<NodeDefinition<unknown, Record<string, unknown>> | undefined>;

let resolver: DeclarativeResolver | null = null;

/** Connect declarative template resolution (import `declarative-bootstrap` once at engine startup). */
export const wireDeclarativeResolver = (r: DeclarativeResolver): void => {
  resolver = r;
};

/** The wired declarative resolver, or null before `declarativeBootstrap` runs. */
export const wiredDeclarativeResolver = (): DeclarativeResolver | null => resolver;
