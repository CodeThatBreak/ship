import { Project, SyntaxKind } from "ts-morph";
const project = new Project({ compilerOptions: { allowJs: true } });
const sf = project.addSourceFileAtPath("lib/engine/templates/templateStore.ts");
const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
const target = calls.find(c => {
  const e = c.getExpression();
  return e.getKind() === SyntaxKind.PropertyAccessExpression && e.getName() === "get" && e.getExpression().getText() === "db";
});
console.log("found:", !!target);
if (target) {
  console.log("parent kind:", target.getParent()?.getKindName());
  target.replaceWithText(`await ${target.getText()}`);
  console.log("done replace");
  sf.saveSync();
}
