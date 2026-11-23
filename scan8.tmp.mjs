import ts from "typescript"; import fs from "node:fs";
const have = new Set(JSON.parse(fs.readFileSync("/tmp/have.json","utf8")));
const out = new Set();
for (const f of process.argv.slice(2)) {
  const src = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const add=(t)=>{t=t.replace(/\s+/g," ").trim(); if(/[A-Za-z]{3}/.test(t) && t.length<=200 && !have.has(t) && !/[{}<>=@\\|]|\$\{|=>|^\w+\(|^[a-z]+[A-Z]\w*$|^[a-z0-9_./ -]+$|\.(tsx?|mjs|css|com|json)\b|^https?:|^[A-Z0-9_]+$|^[.,:;·”“(–-]|[(“]$|^[a-z]/.test(t)) out.add(t);};
  const visit = (n) => {
    if (ts.isJsxText(n)) add(n.text);
    if (ts.isJsxAttribute(n) && ["placeholder","title","aria-label","label","description"].includes(n.name.getText()) && n.initializer && ts.isStringLiteral(n.initializer)) add(n.initializer.text);
    if (ts.isPropertyAssignment(n) && ["label","title","description","hint","summary"].includes(n.name.getText?.()) && ts.isStringLiteral(n.initializer)) add(n.initializer.text);
    ts.forEachChild(n, visit);
  };
  visit(src);
}
fs.writeFileSync(process.env.OUT, JSON.stringify([...out]));
console.log(out.size, [...out].join("").length);
