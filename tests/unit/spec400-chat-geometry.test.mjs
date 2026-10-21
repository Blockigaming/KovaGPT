import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";
const css = readFileSync("src/styles/spec400-chat.css", "utf8");
const sheet = postcss.parse(css);
const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
function declarations(selector, media) {
  const matches = [];
  sheet.walkRules((rule) => {
    if (rule.selector !== selector) return;
    const parentMatches = media
      ? rule.parent.type === "atrule" && rule.parent.params === media
      : rule.parent.type === "root";
    if (parentMatches) matches.push(rule);
  });
  assert.equal(matches.length, 1, `${selector} has one authoritative rule in ${media ?? "root"}`);
  return Object.fromEntries(
    matches[0].nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node]),
  );
}
function panelRadius(rule) {
  assert.equal(rule["border-radius"].value, "var(--kova-radius-panel)");
  assert.equal(rule["border-radius"].important, undefined);
}

test("spec400 composer uses the shared composer geometry without legacy pill selectors", () => {
  const base = declarations(".spec400-composer");
  assert.equal(base["min-height"].value, "128px");
  assert.equal(base["border-radius"].value, "var(--kova-radius-composer)");
  assert.equal(base["border-radius"].important, undefined);
  assert.match(
    readFileSync("src/styles/visual-tokens.css", "utf8"),
    /--kova-radius-composer:\s*28px;/,
  );
  const empty = declarations(
    '.spec400-chat-input[data-composer-surface="empty"] .spec400-composer',
  );
  assert.equal(empty["min-height"].value, "160px");
  const mobile = declarations(".spec400-composer", "(max-width: 1023px)");
  assert.equal(mobile["min-height"].value, "120px");
  assert.doesNotMatch(composer, /className="kova-composer(?:\s|")/);
});

test("spec400 viewport panels retain shared corners while outranking historic size caps", () => {
  assert.match(
    css,
    /\.kova-assistant section\.kova-empty-chat > div\.kova-empty-chat-content\s*\{[^}]*padding-block:\s*32px !important/s,
  );
  const context = declarations("body .spec400-context-drawer[data-kova-dialog-surface]");
  panelRadius(context);
  assert.equal(context["max-width"].value, "300px");
  assert.equal(context["max-height"].value, "100dvh");
  assert.equal(context["max-width"].important, true);
  assert.equal(context["max-height"].important, true);
  assert.equal(context.translate.value, "none");
  assert.equal(context.animation.value, "none");
  const phone = declarations(
    "body .spec400-context-drawer[data-kova-dialog-surface],\n  body .spec400-expanded-input[data-kova-dialog-surface]",
    "(max-width: 767px)",
  );
  panelRadius(phone);
  assert.equal(phone["max-width"].value, "100vw");
  assert.equal(phone["max-height"].value, "100dvh");
  assert.equal(phone["max-width"].important, true);
  assert.equal(phone["max-height"].important, true);
  assert.equal(phone.translate.value, "none");
  assert.equal(phone.animation.value, "none");
  const expanded = declarations(
    ".spec400-expanded-input[data-kova-dialog-surface]",
    "(max-width: 767px)",
  );
  for (const [property, value] of Object.entries({
    inset: "0",
    width: "100vw",
    height: "100dvh",
    margin: "0",
    transform: "none",
  }))
    assert.equal(expanded[property].value, value);
  panelRadius(expanded);
});

test("spec400 failures retry only through a guarded explicit action using the original idempotency identity", () => {
  const route = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(route, /id: requestId \?\? newId\(\)/);
  assert.match(route, /"Idempotency-Key": userMsg\.id/);
  assert.doesNotMatch(route, /_retryAttempt\s*\+\s*1/);
  const ast = ts.createSourceFile(
    "index.tsx",
    route,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const retries = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "send" &&
      node.arguments[6]?.getText(ast) === "userMsg.id"
    )
      retries.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(retries.length, 1, "The failed request has exactly one original-ID replay path");
  const retry = retries[0];
  assert.deepEqual(
    retry.arguments.map((argument) => argument.getText(ast)),
    ["text", "atts", "retryTool", "0", "nextConvId", "priorMessages", "userMsg.id"],
  );
  let click = retry.parent;
  while (click && !(ts.isPropertyAssignment(click) && click.name.getText(ast) === "onClick"))
    click = click.parent;
  assert.ok(click, "Replay requires an explicit action click, never a transport-error side effect");
  const action = click.parent;
  assert.ok(
    action.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(ast) === "label" &&
        property.initializer.getText(ast) === '"Retry"',
    ),
  );
  const callback = click.initializer.getText(ast);
  for (const guard of [
    "!isCurrentRetryScope()",
    "activeIdRef.current !== nextConvId",
    "inFlightRef.current",
    "retryTimerRef.current !== null",
    "retryActionEpochRef.current.get(nextConvId)",
  ])
    assert.ok(callback.includes(guard), guard);
  assert.match(route, /m\.generationStatus === "failed" \? priorUser\.id : undefined/);
});
