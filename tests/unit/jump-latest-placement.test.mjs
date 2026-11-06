import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");
const transcript = readFileSync(
  new URL("../../src/components/ActiveChatTranscript.tsx", import.meta.url),
  "utf8",
);
const file = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function find(predicate) {
  let found;
  const visit = (node) => {
    if (!found && predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(found, "Expected the header implementation");
  return found;
}
const variable = (name) => {
  const declaration = find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name,
  );
  return declaration.initializer.getText(file);
};

test("jump control stays in both chat headers and cannot cover transcript controls", () => {
  const button = variable("jumpToLatestButton");
  assert.match(button, /aria-label="Jump to latest message"/);
  assert.match(button, /<Button\s+variant="ghost"\s+size="icon"/);
  assert.doesNotMatch(button, /absolute|fixed|bottom-full|bottom-28/);
  assert.match(button, /element.scrollTo\(\{ top: element.scrollHeight, behavior: "smooth" \}\)/);
  assert.match(button, /element.focus\(\{ preventScroll: true \}\)/);
  assert.match(variable("desktopToolbar"), /\{jumpToLatestButton\}/);
  const mobile = find(
    (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "MobileTopBar",
  );
  const actions = mobile.attributes.properties.find(
    (node) => ts.isJsxAttribute(node) && node.name.getText(file) === "conversationActions",
  );
  assert.match(actions.getText(file), /jumpToLatestButton/);
  assert.match(transcript, /data-chat-transcript="true"\s+tabIndex=\{-1\}/);
});
