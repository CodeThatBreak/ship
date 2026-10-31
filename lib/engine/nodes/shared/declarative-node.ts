import "server-only";

import { NODE_TRIGGER_TYPE } from "../../constants/triggers";
import { templateStore } from "../../templates/template-store";
import type { FlowContextHelper, FlowCtx } from "./run-context";
import { flowCtxHelper } from "./run-context";
import type { NodeSupport } from "./node-support";
import { nodeSupport } from "./node-support";
import { NodeDefinition } from "./node-definition";
import { AgentRunNode } from "./agent-run-node";
import type { AgentRunner } from "../../harness";
import { agentRunner } from "../../harness";
import {
  parseDeclarativeRunConfig,
  type DeclarativeTemplateKind,
} from "./declarative-run-config";

export type DeclarativeTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  config: unknown;
};

export const declarativeHoldsForApproval = (ctx: FlowCtx, nodeKey: string): boolean => {
  const graph = templateStore.graphForFlow(ctx.flow.id);
  if (!graph) return false;
  const spec = graph.byKey.get(nodeKey);
  return spec?.trigger.type === NODE_TRIGGER_TYPE.APPROVAL;
};

/**
 * Shared identity + config validation for declarative `node_templates` rows
 * (agent / decision / http / script).
 */
export abstract class DeclarativeNode<
  Def,
  I = Record<string, unknown>,
  O extends Record<string, unknown> = Record<string, unknown>,
> extends NodeDefinition<I, O> {
  readonly key: string;
  readonly label: string;
  readonly def: Def;
  description?: string;

  protected readonly declarativeKind: DeclarativeTemplateKind;

  protected constructor(
    tmpl: DeclarativeTemplateRow,
    instanceKey: string | undefined,
    def: Def,
    kind: DeclarativeTemplateKind,
    support: NodeSupport = nodeSupport,
    ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {
    super(support, ctxHelper);
    this.key = instanceKey ?? tmpl.id;
    this.label = tmpl.name;
    this.def = def;
    this.description = tmpl.description ?? undefined;
    this.declarativeKind = kind;
  }

  override defaultConfig(): Record<string, unknown> {
    return this.def as unknown as Record<string, unknown>;
  }

  override parseRunConfig(config: Record<string, unknown>): Record<string, unknown> {
    return parseDeclarativeRunConfig(this.declarativeKind, config, this.label);
  }

  protected runConfig(config: Record<string, unknown>): Def {
    return this.parseRunConfig(config) as unknown as Def;
  }

  protected holdsForApproval(ctx: FlowCtx): boolean {
    return declarativeHoldsForApproval(ctx, this.key);
  }
}

/** Declarative kinds whose runs go through the agent runner tier. */
export abstract class DeclarativeAgentNode<
  Def,
  I = Record<string, unknown>,
  O extends Record<string, unknown> = Record<string, unknown>,
> extends AgentRunNode<I, O> {
  readonly key: string;
  readonly label: string;
  readonly def: Def;
  description?: string;

  protected readonly declarativeKind: DeclarativeTemplateKind;

  protected constructor(
    tmpl: DeclarativeTemplateRow,
    instanceKey: string | undefined,
    def: Def,
    kind: DeclarativeTemplateKind,
    services: {
      support?: NodeSupport;
      runner?: AgentRunner;
      ctxHelper?: FlowContextHelper;
    } = {},
  ) {
    super(services.support, services.runner ?? agentRunner, services.ctxHelper);
    this.key = instanceKey ?? tmpl.id;
    this.label = tmpl.name;
    this.def = def;
    this.description = tmpl.description ?? undefined;
    this.declarativeKind = kind;
  }

  override defaultConfig(): Record<string, unknown> {
    return this.def as unknown as Record<string, unknown>;
  }

  override parseRunConfig(config: Record<string, unknown>): Record<string, unknown> {
    return parseDeclarativeRunConfig(this.declarativeKind, config, this.label);
  }

  protected runConfig(config: Record<string, unknown>): Def {
    return this.parseRunConfig(config) as unknown as Def;
  }

  protected holdsForApproval(ctx: FlowCtx): boolean {
    return declarativeHoldsForApproval(ctx, this.key);
  }
}
