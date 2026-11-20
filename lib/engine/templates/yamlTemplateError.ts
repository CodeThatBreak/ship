import "server-only";

/** Typed error for YAML template import/compile failures — surfaces the parser's message verbatim to the template editor. Never carries anything but the message: the YAML text is already on the user's screen. */
export class YamlTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamlTemplateError";
  }
}
