import ts from "typescript";

// Compare rendered JSX and its inline handlers independently of separately tested data lifecycles.
export function jsxContract(source) {
  const ast = ts.createSourceFile(
    "view.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out = [];
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      out.push(
        ts.transpileModule(`const view = (${node.getText(ast)});`, {
          compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
        }).outputText,
      );
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return out.join("\n");
}
