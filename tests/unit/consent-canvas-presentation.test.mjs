import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import * as policy from "../../src/lib/pricing/mcp-oauth-policy.mjs";
import {
  loadUiModule,
  createHookHarness,
  elements,
  text,
  settle,
} from "../helpers/ui-state-harness.mjs";
import { consentPresentation } from "../helpers/consent-presentation-contract.mjs";
const base = "f18729f0f99a0596ad1db2cfbbadfafdd2d654f7";
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
test("Consent limits, defaults, permissions, project selection, validation and decision code remain exact apart from declared presentation", () => {
  const p = "src/components/DeveloperMcpAccess.tsx",
    old = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
    actual = readFileSync(p, "utf8");
  assert.equal(compile(actual), compile(consentPresentation(old)));
});
test("Populated consent fields reference full visible labels/units and maximum descriptions without changing any choices", async () => {
  const h = createHookHarness(),
    projects = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "USD project",
        currency: "USD",
        request_limit: 5,
        daily_limit: 20,
        monthly_limit: 100,
        concurrent_limit: 3,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "EUR project",
        currency: "EUR",
        request_limit: 7,
        daily_limit: 30,
        monthly_limit: 150,
        concurrent_limit: 4,
      },
    ],
    calls = [];
  const row = {
    id: "33333333-3333-4333-8333-333333333333",
    clientName: "Synthetic client",
    clientId: "client",
    redirectUri: "https://example.test/callback",
    resource: "https://example.test/mcp",
    scopes: [...policy.MCP_OAUTH_SCOPES],
    projects,
    refreshAllowed: false,
  };
  const { DeveloperMcpConsentPanel } = loadUiModule(
    "src/components/DeveloperMcpAccess.tsx",
    {
      react: h.react,
      "@tanstack/react-router": { Link: "Link" },
      "@/components/auth/ClerkSafe": {},
      "@/components/auth/AuthDialog": { AuthDialog: "AuthDialog" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/input": { Input: "Input" },
      "@/lib/pricing/mcp-oauth-client": {
        requestMcpOwner: async (...args) => {
          assert.equal(args.length, 3, "no decision request permitted");
          calls.push(args);
          return row;
        },
        verifiedMcpRedirect: () => {
          throw Error("No redirect permitted");
        },
      },
      "@/lib/pricing/mcp-oauth-policy.mjs": policy,
      "@/lib/principal-browser-storage.mjs": {},
    },
    { AbortController },
  );
  const render = () => h.render(DeveloperMcpConsentPanel, { ownerId: "owner", requestId: row.id });
  render();
  await settle();
  let tree = render();
  assert.ok(
    elements(tree, (n) => n.type === "section")[0].props.className.includes(
      "kova-workspace-controls",
    ),
  );
  for (const project of projects) {
    elements(tree, (n) => n.type === "select")[0].props.onChange({ target: { value: project.id } });
    tree = render();
    const fields = elements(tree, (n) => n.type === "Input"),
      keys = ["request", "daily", "monthly", "concurrent"],
      labels = [
        `Maximum per request (${project.currency})`,
        `Daily limit (${project.currency})`,
        `Monthly limit (${project.currency})`,
        `Concurrent requests`,
      ];
    assert.equal(fields.length, 4);
    fields.forEach((field, i) => {
      const label = elements(tree, (n) => n.props.id === field.props["aria-labelledby"])[0],
        help = elements(tree, (n) => n.props.id === field.props["aria-describedby"])[0];
      assert.equal(text(label).replace(/\s+/g, " ").trim(), labels[i]);
      assert.equal(
        text(help).replace(/\s+/g, " ").trim(),
        `At most ${project[keys[i] + "_limit"]} ${i === 3 ? "requests" : project.currency}`,
      );
      assert.equal(field.props["aria-label"], undefined);
      assert.equal(field.props.value, "");
      assert.equal(field.props.min, i === 3 ? 1 : 0);
      assert.equal(field.props.step, i === 3 ? 1 : "any");
    });
    assert.equal(
      elements(tree, (n) => n.type === "Button" && text(n).includes("Approve"))[0].props.disabled,
      true,
    );
    const checkboxes = elements(tree, (n) => n.type === "input" && n.props.type === "checkbox");
    assert.equal(checkboxes.length, 5);
    assert.ok(checkboxes.slice(0, 4).every((n) => n.props.checked));
    assert.equal(checkboxes[4].props.checked, false);
  }
  assert.equal(calls.length, 1);
  h.unmount();
});
for (const name of ["ArtifactEditor", "CanvasComments"])
  test(`Canvas ${name} comment operation remains unchanged; only phone target marker added`, () => {
    const p = `src/components/${name}.tsx`,
      old = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
      actual = readFileSync(p, "utf8"),
      expected = old.replace(
        'className="mt-2 min-h-9 rounded-lg bg-foreground px-3 text-xs text-background disabled:opacity-50"',
        'className="kova-workspace-action mt-2 min-h-9 rounded-lg bg-foreground px-3 text-xs text-background disabled:opacity-50"',
      );
    assert.notEqual(expected, old);
    assert.equal(compile(actual), compile(expected));
  });
