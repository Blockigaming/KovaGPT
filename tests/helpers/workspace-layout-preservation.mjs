import ts from "typescript";
import postcss from "postcss";
export function eventAttributes(source) {
  const ast = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const result = [];
  const printer = ts.createPrinter();
  function visit(node) {
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(ast)))
      result.push(printer.printNode(ts.EmitHint.Unspecified, node, ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
export function shellLogic(source) {
  return source.slice(
    source.indexOf("  const navigate ="),
    source.indexOf("  const utilities =") < 0
      ? source.indexOf('  return (\n    <div className="kova-app-shell')
      : source.indexOf("  const utilities ="),
  );
}
export function dialogRules(source) {
  const result = [];
  postcss.parse(source).walkRules((rule) => {
    if (/dialog|focus/.test(rule.selector)) result.push(rule.toString());
  });
  return result;
}
