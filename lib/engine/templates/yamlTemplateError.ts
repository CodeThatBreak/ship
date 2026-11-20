export class YamlTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamlTemplateError";
  }
}
