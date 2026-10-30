import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
const source = readFileSync("src/routes/apps.tsx", "utf8");
const parsed = ts.createSourceFile(
  "apps.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const find = (predicate) => {
  let result;
  const visit = (node) => {
    if (predicate(node)) result = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(result);
  return result;
};
const compile = (code, dependencies) =>
  new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(dependencies));
const cardSource = find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "AppCard",
).getText(parsed);
const Card = compile(`${cardSource};return AppCard;`, {
  React,
  AppLogo: "logo",
  StatusBadge: "status",
  Button: "button",
});
const buttonOf = (node) => {
  if (!node || typeof node !== "object") return null;
  if (node.type === "button") return node;
  return React.Children.toArray(node.props?.children).map(buttonOf).find(Boolean);
};
test("spec400 card actions always open details, including unavailable and recovery states", () => {
  for (const [state, configured, label] of [
    ["idle", true, "Connect"],
    ["connected", true, "Manage"],
    ["reauthorize", true, "Reconnect"],
    ["permission_incomplete", true, "Reconnect"],
    ["temporarily_unavailable", false, "Unavailable"],
  ]) {
    let trigger;
    const button = buttonOf(
      Card({
        item: { id: "gmail", label: "Gmail", description: "Read mail", category: "Email" },
        state,
        configured,
        onDetails: (value) => {
          trigger = value;
        },
      }),
    );
    assert.equal(button.props.children, label);
    assert.equal(button.props["aria-haspopup"], "dialog");
    const target = {};
    button.props.onClick({ currentTarget: target });
    assert.equal(trigger, target);
  }
});
test("spec400 directory uses approved catalog, primary tabs, neutral scoped styles, and verified redirects", () => {
  assert.match(source, /const catalog = LAUNCH_PLUGIN_REVIEW_CATALOG.map/);
  assert.match(source, /title="Connections"/);
  assert.match(source, /description="Connect tools and sources to Kova"/);
  assert.match(source, /<TabsTrigger value="all">/);
  assert.match(source, /<TabsTrigger value="connected">/);
  assert.match(source, /status.connected && status.state === "connected"/);
  assert.doesNotMatch(source, /toast.success\("Google account connected"\)/);
  assert.match(source, /Scheduled tasks or projects that depend on this account/);
  assert.match(source, /account.scopes.map/);
  const css = readFileSync("src/styles/spec400-plugins.css", "utf8");
  assert.match(css, /width: 48px/);
  assert.match(css, /max-width: 1080px/);
  assert.doesNotMatch(css, /gradient/);
});
