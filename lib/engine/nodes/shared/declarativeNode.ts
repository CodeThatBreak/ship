import "server-only";

import type { FlowContextHelper } from "./runContext/flowContextHelper";
import type { FlowCtx } from "./runContext/types/flowContext";
import { flowCtxHelper } from "./runContext";
import type { NodeSupport } from "./nodeSupport";
import { nodeSupport } from "@/lib/composition/container";
import { NodeDefinition } from "./nodeDefinition";
import { AgentRunNode } from "./agentRunNode";
import type { AgentRunner } from "../../harness/harnessExports";
import { agentRunner } from "../../harness/harnessExports";
import {
  parseDeclarativeRunConfig,
  type DeclarativeTemplateKind,
} from "./declarativeRunConfig";
import type { DeclarativeTemplateRow } from "./types/declarativeTemplateRow";
import { declarativeHoldsForApproval } from "./utils/declarativeHoldsForApproval";

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

  protected async holdsForApproval(ctx: FlowCtx): Promise<boolean> {
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

  protected async holdsForApproval(ctx: FlowCtx): Promise<boolean> {
    return declarativeHoldsForApproval(ctx, this.key);
  }
}
