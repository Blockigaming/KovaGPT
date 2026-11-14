import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";
import * as principalStorage from "../../src/lib/principal-browser-storage.mjs";
import { parseAllowedBillingPortalUrl } from "../../src/lib/billing-portal-url.mjs";
import { voiceReadiness } from "../../scripts/voice/check-elevenlabs.mjs";

function fixture(kind) {
  const hooks = createHookHarness(),
    requests = [],
    redirects = [];
  let owner = "owner-a",
    priceId = "price_pro";
  const deps = {
    react: hooks.react,
    "@/components/auth/ClerkSafe": {
      useUser: () => ({
        isLoaded: true,
        isSignedIn: Boolean(owner),
        user: owner ? { id: owner } : null,
      }),
    },
    "@/components/ui/button": { Button: "Button" },
    "@/lib/auth-fetch": {
      authFetch: (url, options) => {
        const pending = deferred();
        requests.push({ url, options, ...pending });
        return pending.promise;
      },
    },
    "@/utils/payments.functions": {
      createPortalSession: (args) => {
        const pending = deferred();
        requests.push({ args, ...pending });
        return pending.promise;
      },
    },
    "@/lib/billing-portal-url.mjs": { parseAllowedBillingPortalUrl },
  };
  deps["@/lib/principal-browser-storage.mjs"] = principalStorage;
  deps["@/lib/voice/preference"] = loadUiModule("src/lib/voice/preference.ts", deps);
  const name = kind === "voice" ? "VoiceConnectionStatus" : "BillingPortalButton";
  const module = loadUiModule(`src/components/${name}.tsx`, deps, {
    window: { location: { assign: (url) => redirects.push(url) } },
    AbortSignal,
  });
  let tree;
  const render = () => (tree = hooks.render(module[name], { priceId }));
  render();
  render();
  const button = () => elements(tree, (node) => node.type === "Button")[0];
  return {
    hooks,
    requests,
    redirects,
    render,
    button,
    click: () => button().props.onClick(),
    view: () => text(tree),
    owner: (id) => {
      owner = id;
      render();
      render();
    },
    price: (id) => {
      priceId = id;
      render();
      render();
    },
  };
}
test("voice configuration probe is authenticated and consumes no provider request", async () => {
  const f = fixture("voice");
  assert.equal(f.requests.length, 1);
  f.click();
  f.click();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/voice");
  assert.equal(f.requests[0].options.headers["X-Kova-Voice-Owner"], "owner-a");
  assert.equal(f.requests[0].options.cache, "no-store");
  f.requests[0].resolve({ ok: true, json: async () => ({ stt: true, conversation: false }) });
  await settle();
  f.render();
  assert.match(f.view(), /Dictation:.*Configured.*Voice conversations:.*Unavailable/);
});
test("voice probe ignores stale owners and allows the new owner to retry", async () => {
  const f = fixture("voice");
  f.click();
  f.owner("owner-b");
  f.click();
  f.requests[0].resolve({ ok: true, json: async () => ({ stt: true, conversation: true }) });
  await settle();
  f.render();
  assert.doesNotMatch(f.view(), /Dictation:/);
  assert.equal(f.button().props.disabled, true);
  f.requests[1].resolve({ ok: false, json: async () => ({}) });
  await settle();
  f.render();
  assert.equal(f.button().props.disabled, false);
  assert.match(f.view(), /couldn't be checked/);
});
test("hosted billing uses the chosen server-allowlisted price and suppresses duplicate requests", async () => {
  const f = fixture("billing");
  f.click();
  f.click();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].args.data.priceId, "price_pro");
  f.requests[0].resolve({ url: "https://billing.stripe.com/p/session_fixture" });
  await settle();
  assert.deepEqual(f.redirects, ["https://billing.stripe.com/p/session_fixture"]);
});
test("stale, unmounted or unsafe billing responses cannot redirect", async () => {
  for (const invalidate of [
    (f) => f.owner("owner-b"),
    (f) => f.price("price_plus"),
    (f) => f.hooks.unmount(),
  ]) {
    const f = fixture("billing");
    f.click();
    invalidate(f);
    f.requests[0].resolve({ url: "https://billing.stripe.com/p/session_old" });
    await settle();
    assert.deepEqual(f.redirects, []);
  }
  const unsafe = fixture("billing");
  unsafe.click();
  unsafe.requests[0].resolve({ url: "https://attacker.invalid/" });
  await settle();
  unsafe.render();
  assert.deepEqual(unsafe.redirects, []);
  assert.match(unsafe.view(), /could not open/);
  assert.equal(unsafe.button().props.disabled, false);
});
test("voice readiness report contains no credential or provider voice ID and claims no live verification", () => {
  const report = voiceReadiness({
    ELEVENLABS_API_KEY: "private-test-value",
    ELEVENLABS_VOICE_ID: "private-test-voice",
  });
  assert.equal(report.secretPresent, true);
  assert.equal(report.liveProviderVerified, false);
  assert.doesNotMatch(JSON.stringify(report), /private-test/);
});
