/**
 * Step-01 codemod: per-file sync→async for db call sites.
 * One file at a time, string-safe: we only rewrite call-expression text.
 * Usage: node scripts/pg-morph2.mjs <file> [...]
 */
import { Project, SyntaxKind } from "ts-morph";

const CALLS = new Set([
  "get", "all", "run", "emitEvent", "addMessage", "listMessages", "listEvents",
  "listEventsTail", "getSetting", "setSetting", "listRepos", "repoById",
  "repoByCloudUrl", "upsertRepo", "deleteRepo", "countFlowsByRepoId",
]);
const RECVS = new Set(["db", "rows", "this.db", "this.rows", "this.database", "database"]);

const isDbCall = (call) => {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
  if (!CALLS.has(expr.getName())) return false;
  return RECVS.has(expr.getExpression().getText());
};

const nearestFn = (node) =>
  node.getFirstAncestor((a) =>
    [
      SyntaxKind.MethodDeclaration,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.ArrowFunction,
      SyntaxKind.FunctionExpression,
      SyntaxKind.Constructor,
    ].includes(a.getKind())
  );

function processFile(sf) {
  // 1. await all db/rows calls
  for (;;) {
    const call = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((c) => isDbCall(c) && c.getParent()?.getKind() !== SyntaxKind.AwaitExpression);
    if (!call) break;
    call.replaceWithText(`await ${call.getText()}`);
  }
  // 2. async-mark functions containing await (repeat until fixpoint)
  for (;;) {
    const aw = sf
      .getDescendantsOfKind(SyntaxKind.AwaitExpression)
      .find((a) => {
        const fn = nearestFn(a);
        return fn && fn.getKind() !== SyntaxKind.Constructor && !fn.isAsync?.();
      });
    if (!aw) break;
    const fn = nearestFn(aw);
    fn.setIsAsync(true);
  }
  // 3. arrow callers that return a promise need async too (void-wrapped db ops
  //    stay sync; handled by the await fixpoint)
}

const files = process.argv.slice(2);
for (const f of files) {
  const project = new Project({ compilerOptions: { allowJs: true } });
  const sf = project.addSourceFileAtPath(f);
  const before = sf.getFullText();
  processFile(sf);
  const after = sf.getFullText();
  if (after !== before) {
    sf.saveSync();
    console.log("converted", f);
  } else {
    console.log("unchanged", f);
  }
}
