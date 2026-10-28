import type { FlowCtx } from './run-context';
import { buildFlowContext } from '../../context/flow-variables';
import { TemplateComposer } from './template-composer';

/**
 * Prompt rendering for declarative nodes: builds the `{{expr}}` variable map
 * from the flow context and interpolates templates against it. Stateless —
 * every method is static, no instance required.
 */
export class TemplateRenderer {
  /**
   * Prompt variables available to `{{expr}}` references in node prompts
   * (§3 input mapping context): the shared flow-context map —
   * `{{task.*}}`, `{{repo.*}}`, `{{flow.*}}`, `{{trigger.payload.*}}`, and
   * `{{nodes.<key>.output.*}}` (outputs of upstream nodes, small structured data
   * — large content stays in artifacts and reaches prompts as prompt variables,
   * §5 data-passing rule) — plus `{{input.*}}`: the inherited run input, i.e.
   * the previous node's output fields (the node declares no input contract).
   */
  static vars(ctx: FlowCtx): Record<string, unknown> {
    return buildFlowContext(ctx) as unknown as Record<string, unknown>;
  }

  /**
   * Start a fluent multi-part template (see {@link TemplateComposer}):
   * accumulate lines/sections, then `.render(vars)` to interpolate.
   */
  static compose(initial = ''): TemplateComposer {
    return new TemplateComposer(initial);
  }

  static readonly templateRegex: RegExp = /\{\{([^{}]+)\}\}/g;

  /** `{{a.b.c}}` interpolation against the flow variable map. */
  static render(prompt: string, vars: Record<string, unknown>): string {
    return prompt.replace(this.templateRegex, (_, raw: string) => {
      const segments = raw.trim().split('.');
      let v: unknown = vars;
      for (const seg of segments) {
        if (v == null || typeof v !== 'object') {
          v = undefined;
          break;
        }
        v = (v as Record<string, unknown>)[seg];
      }
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return JSON.stringify(v);
    });
  }
}
