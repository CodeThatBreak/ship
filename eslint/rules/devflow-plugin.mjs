/** @type {import("eslint").Rule.RuleModule} */
export const requireNodejsRuntimeRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Require export const runtime = "nodejs" on App Router API route modules',
    },
    schema: [],
    messages: {
      missing:
        'API routes that use the Node runtime (better-sqlite3, lib/) must export `export const runtime = "nodejs";`.',
    },
  },
  create(context) {
    const hasNodejsRuntimeExport = (body) =>
      body.some(
        (statement) =>
          statement.type === "ExportNamedDeclaration" &&
          statement.declaration?.type === "VariableDeclaration" &&
          statement.declaration.declarations.some(
            (decl) =>
              decl.id.type === "Identifier" &&
              decl.id.name === "runtime" &&
              decl.init?.type === "Literal" &&
              decl.init.value === "nodejs",
          ),
      );

    return {
      Program(node) {
        if (!hasNodejsRuntimeExport(node.body)) {
          context.report({ node, messageId: "missing" });
        }
      },
    };
  },
};

export const devflowPlugin = {
  rules: {
    "require-nodejs-runtime": requireNodejsRuntimeRule,
  },
};
