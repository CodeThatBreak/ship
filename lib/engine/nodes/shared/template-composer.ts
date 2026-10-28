import { TemplateRenderer } from './template-renderer';

/**
 * Fluent composer for multi-part prompt templates (paired with
 * {@link TemplateRenderer}): accumulate lines, sections and bullet lists,
 * then interpolate `{{expr}}` refs in one pass at the end. Skipped-empty
 * semantics keep call sites free of `if (x)` guards around optional parts.
 *
 * ```ts
 * const prompt = TemplateRenderer
 *   .compose('You are deciding the next branch.')
 *   .addBlankLine()
 *   .section('Question', question)
 *   .bullets(choices)
 *   .render(vars);
 * ```
 */
export class TemplateComposer {
  private readonly parts: string[];

  constructor(initial = '') {
    this.parts = initial ? [initial] : [];
  }

  /** Append a raw chunk of text verbatim — no separator is added. */
  text(value: string): this {
    if (value) this.parts.push(value);
    return this;
  }

  /** Append one line. */
  addLine(value: string): this {
    this.parts.push(value);
    return this;
  }

  /** Append each entry as its own line, skipping empty entries. */
  addLines(values: ReadonlyArray<string | null | undefined>): this {
    for (const value of values) {
      if (value) this.parts.push(value);
    }
    return this;
  }

  /** Append an empty separator line. */
  addBlankLine(): this {
    this.parts.push('');
    return this;
  }

  /**
   * Append a `- ` bullet per entry, skipping empty entries; an optional
   * suffix is appended to each bullet (`- label: description`).
   */
  bullets(values: ReadonlyArray<string | null | undefined>, suffixOf?: (value: string) => string): this {
    for (const value of values) {
      if (!value) continue;
      const suffix = suffixOf?.(value);
      this.parts.push(`- ${suffix ? `${value}: ${suffix}` : value}`);
    }
    return this;
  }

  /**
   * Append a `Heading:\n<body>` block — skipped entirely when the body is
   * empty or whitespace, so optional parts vanish instead of leaving
   * dangling headings.
   */
  section(heading: string, body: string | null | undefined): this {
    const trimmed = (body ?? '').trim();
    if (!trimmed) return this;
    this.parts.push(`${heading}:`);
    this.parts.push(trimmed);
    return this;
  }

  /** The composed, un-rendered template. */
  build(): string {
    return this.parts.join('\n');
  }

  /** Interpolate `{{expr}}` refs against `vars` and return the final text. */
  render(vars: Record<string, unknown>): string {
    return TemplateRenderer.render(this.build(), vars);
  }

  toString(): string {
    return this.build();
  }
}
