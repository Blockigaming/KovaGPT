import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { LAUNCH_CONNECTORS } from "../../src/integrations/launch-contracts.mjs";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";
const account = {
  id: "33333333-3333-4333-8333-333333333333",
  label: "Account",
  identity: "provider-user",
  status: "connected",
  scopes: ["Mail.Read"],
  expiresAt: null,
  lastSuccessAt: null,
};
function fixture() {
  const hooks = createHookHarness(),
    calls = [],
    navigations = [];
  const module = loadUiModule(
    "src/components/LaunchConnectorManager.tsx",
    {
      react: hooks.react,
      zod: { z },
      "@/integrations/launch-contracts.mjs": { LAUNCH_CONNECTORS },
      "@/lib/auth-fetch": {
        fetchWithTimeoutAuthenticated: (url, init) => {
          const d = deferred();
          calls.push({ url, init, ...d });
          return d.promise;
        },
      },
    },
    {
      AbortController,
      URL,
      Error,
      window: { location: { assign: (url) => navigations.push(url) } },
    },
  );
  const render = () => hooks.render(module.LaunchConnectorManager, { connector: "outlook" });
  const status = (certified = false) =>
    Response.json({ connector: "outlook", certified, accounts: [account], nextCursor: null });
  return { hooks, calls, navigations, render, status };
}
const button = (tree, name) =>
  elements(tree, (n) => n.type === "button" && text(n).replace(/\s+/g, " ").trim() === name)[0];
test("inactive connector shows actual metadata, unchecked consent and no connect dispatch", async () => {
  const f = fixture();
  f.render();
  f.calls[0].resolve(f.status());
  await settle();
  let tree = f.render();
  assert.match(text(tree), /provider-user/);
  assert.match(text(tree), /Mail.Read/);
  assert.equal(elements(tree, (n) => n.type === "input")[0].props.checked, false);
  assert.equal(button(tree, "Connect or reconnect Outlook").props.disabled, true);
  await button(tree, "Connect or reconnect Outlook").props.onClick();
  assert.equal(f.calls.length, 1);
});
test("disconnect requires selected account confirmation and retains provider uncertainty", async () => {
  const f = fixture();
  f.render();
  f.calls[0].resolve(f.status());
  await settle();
  let tree = f.render();
  button(tree, "Disconnect Account").props.onClick();
  tree = f.render();
  button(tree, "Confirm disconnect").props.onClick();
  assert.deepEqual(JSON.parse(f.calls[1].init.body), {
    action: "disconnect",
    accountId: account.id,
  });
  f.calls[1].resolve(
    Response.json({ localDisconnected: true, providerRevoked: false, cleanupRecorded: true }),
  );
  await settle();
  assert.equal(f.calls.length, 3);
  f.calls[2].resolve(f.status());
  await settle();
  tree = f.render();
  assert.match(text(tree), /Provider revocation is unconfirmed/);
});
test("unmount aborts pending connection and prevents late navigation", async () => {
  const f = fixture();
  f.render();
  f.calls[0].resolve(f.status(true));
  await settle();
  let tree = f.render();
  elements(tree, (n) => n.type === "input")[0].props.onChange({ target: { checked: true } });
  tree = f.render();
  button(tree, "Connect or reconnect Outlook").props.onClick();
  f.hooks.unmount();
  assert.equal(f.calls[1].init.signal.aborted, true);
  f.calls[1].resolve(Response.json({ url: LAUNCH_CONNECTORS.outlook.authorize + "?state=test" }));
  await settle();
  assert.deepEqual(f.navigations, []);
});

test("failed status refresh retains known accounts and blocks mutation until review succeeds", async () => {
  const f = fixture();
  f.render();
  f.calls[0].resolve(f.status(true));
  await settle();
  let tree = f.render();
  button(tree, "Refresh saved status").props.onClick();
  f.calls[1].resolve(new Response(null, { status: 503 }));
  await settle();
  tree = f.render();
  assert.match(text(tree), /provider-user/);
  assert.match(text(tree), /could not be confirmed/);
  assert.equal(button(tree, "Disconnect Account").props.disabled, true);
  button(tree, "Refresh saved status").props.onClick();
  f.calls[2].resolve(f.status(true));
  await settle();
  tree = f.render();
  assert.equal(button(tree, "Disconnect Account").props.disabled, false);
});
test("authorization response cannot navigate to an unrelated origin", async () => {
  const f = fixture();
  f.render();
  f.calls[0].resolve(f.status(true));
  await settle();
  let tree = f.render();
  elements(tree, (n) => n.type === "input")[0].props.onChange({ target: { checked: true } });
  tree = f.render();
  button(tree, "Connect or reconnect Outlook").props.onClick();
  f.calls[1].resolve(Response.json({ url: "https://unrelated.example/collect" }));
  await settle();
  assert.deepEqual(f.navigations, []);
  assert.match(text(f.render()), /could not be started safely/);
});
