import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, loadUiModule, deferred, settle } from "../helpers/ui-state-harness.mjs";
import * as flows from "../../src/integrations/connection-flows.mjs";

function fixture() {
  const hooks = createHookHarness(),
    pending = [];
  const mod = loadUiModule("src/hooks/use-connected-accounts.ts", {
    react: hooks.react,
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    "@/lib/auth-fetch": {
      authFetch() {},
      fetchWithTimeoutAuthenticated: () => {
        const wait = deferred();
        pending.push(wait);
        return wait.promise;
      },
    },
    "@/components/ConfirmActionDialog": { ConfirmActionDialog: "confirm" },
    "@/lib/connected-accounts.functions": { searchConnectedAccount() {} },
    "@/integrations/connection-flows.mjs": flows,
    sonner: { toast: { error() {}, success() {} } },
  });
  return {
    hooks,
    pending,
    render(principal = "owner-a", enabled = true) {
      return hooks.render(() => mod.useConnectedAccounts(principal, enabled));
    },
  };
}
const response = (id) => ({
  ok: true,
  json: async () => ({ configuredProviders: [{ id: "microsoft" }], accounts: [{ id }] }),
});

test("a late account response cannot cross an owner transition", async () => {
  const f = fixture();
  f.render("owner-a");
  assert.equal(f.pending.length, 1);
  f.render("owner-b");
  f.pending[0].resolve(response("account-a"));
  await settle();
  assert.equal(f.render("owner-b").data, null);
  f.pending[1].resolve(response("account-b"));
  await settle();
  assert.equal(f.render("owner-b").data.accounts[0].id, "account-b");
  assert.equal(f.render("guest", false).data, null);
});

test("out-of-order refresh and unmount cannot overwrite the latest account status", async () => {
  const f = fixture();
  f.render();
  const view = f.render();
  const next = view.reload();
  f.pending[1].resolve(response("latest"));
  await next;
  await settle();
  f.pending[0].resolve(response("old"));
  await settle();
  assert.equal(f.render().data.accounts[0].id, "latest");
  const unmounted = f.render().reload();
  f.hooks.unmount();
  f.pending[2].resolve(response("late"));
  await unmounted;
  await settle();
  assert.equal(f.render().data.accounts[0].id, "latest");
});

test("account status failures stay errors instead of a verified disconnected state", async () => {
  const f = fixture();
  f.render();
  f.pending[0].resolve({ ok: false, json: async () => ({ error: "unavailable" }) });
  await settle();
  const view = f.render();
  assert.equal(view.error, true);
  assert.equal(view.loading, false);
  assert.equal(view.data, null);
});
