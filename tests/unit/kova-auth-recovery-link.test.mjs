import assert from "node:assert/strict";
import test from "node:test";
import * as recovery from "../../src/lib/kova-recovery-link.mjs";
import * as landing from "../../src/lib/kova-recovery-landing.mjs";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import { digestKovaToken } from "../../src/lib/kova-auth-crypto.server.mjs";

const token = "t".repeat(43);
const base = "https://kova.test/reset-password";

test("recovery emails use a fragment; the raw bearer is absent from the HTTP target and public response", async () => {
  let payload;
  const h = authHttp({
    env: { KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test", KOVA_EMAIL_QUEUE_ENABLED: "true" },
    rpc: async (name, args) => {
      assert.equal(name, "kova_auth_create_recovery");
      payload = args;
      return { data: true };
    },
  });
  const response = await h.handleKovaRecoveryRequest(
    authRequest({ email: "owner@example.test" }, { path: "/api/auth/recovery/request" }),
  );
  assert.equal(response.status, 202);
  const link = new URL(payload.p_email_payload.text.split("\n\n")[1]);
  assert.equal(link.origin + link.pathname + link.search, base);
  const value = new URLSearchParams(link.hash.slice(1)).get("token");
  assert.match(value, /^[A-Za-z0-9_-]{43,128}$/u);
  assert.equal(digestKovaToken(value), payload.p_recovery_digest_hex);
  assert.ok(!JSON.stringify([...h.logs, await response.json()]).includes(value));
});

for (const mode of ["kova", "dual"]) {
  test(`${mode}: fragment-only recovery is accepted, while logged or ambiguous credentials are scrubbed and rejected`, () => {
    assert.deepEqual(recovery.readKovaRecoveryLink(`${base}?lang=en#token=${token}`, mode), {
      owned: true,
      token,
      cleanPath: "/reset-password?lang=en",
    });
    for (const suffix of [
      `?token=${token}`,
      `?token=${token}#token=${token}`,
      `#token=${token}&token=${token}`,
      "#token=short",
      `#token=${token}&access_token=other`,
      "#token=",
      `?token=a&token=b`,
    ]) {
      const result = recovery.readKovaRecoveryLink(base + suffix, mode);
      assert.equal(result.owned, true);
      assert.equal(result.token, null);
      assert.equal(result.cleanPath, "/reset-password");
    }
  });
}
test("pure Kova never starts hosted recovery; dual mode without a Kova credential retains legacy recovery", () => {
  assert.equal(recovery.readKovaRecoveryLink(base, "kova").owned, true);
  assert.equal(recovery.readKovaRecoveryLink(`${base}?code=legacy`, "dual").owned, false);
  assert.equal(recovery.readKovaRecoveryLink(`${base}#token=${token}`, "supabase").token, null);
});

function page(suffix, mode = "kova", scrubFails = false) {
  const events = [];
  const location = new URL(base + suffix);
  location.replace = (path) => events.push(["navigate", path]);
  const window = {
    location,
    history: {
      replaceState(_state, _title, path) {
        events.push(["scrub", path]);
        if (scrubFails) throw new Error("history blocked");
        location.href = new URL(path, base).href;
      },
    },
  };
  const f = reactFixture("src/routes/reset-password.tsx", (exports) => exports.Route.component, {
    globals: { window, document: { title: "Recovery" }, URLSearchParams, console: { error() {} } },
    modules: {
      "@tanstack/react-router": {
        createFileRoute: () => (config) => config,
        useNavigate: () => () => {},
      },
      "@/components/NovaLogo": { NovaLogo: "logo" },
      "@/integrations/supabase/client": {
        getSupabaseClientConfigStatus: () => {
          throw new Error("Hosted recovery must not run");
        },
        supabase: {
          auth: new Proxy(
            {},
            {
              get() {
                throw new Error("Hosted recovery must not run");
              },
            },
          ),
        },
      },
      "@/lib/oauth-session": {},
      "@/lib/kova-recovery-link.mjs": recovery,
      "@/lib/kova-recovery-landing.mjs": landing,
      "@/lib/kova-auth-browser": {
        browserKovaAuthEnabled: () => mode !== "supabase",
        browserKovaAuthMode: () => mode,
        kovaPublicAuthJson: async (path, body) => {
          events.push(["submit", path, body]);
          return Response.json({
            session: { accountId: "10000000-0000-4000-8000-000000000001", emailVerified: true },
          });
        },
      },
    },
  });
  return { f, events, location };
}

test("the real reset form strips the fragment before enabling fields and sends its in-memory token only on explicit submit", async () => {
  const { f, events, location } = page(`#token=${token}`);
  f.render();
  assert.equal(
    f.nodes().some((node) => node.type === "form"),
    false,
  );
  await f.flush();
  assert.deepEqual(events, [["scrub", "/reset-password"]]);
  assert.equal(location.href, base);
  f.replayEffects();
  await f.flush();
  assert.equal(location.href, base);
  // Effect replay must retain the captured in-memory proof, not parse a second
  // credential or repeat an already-completed history mutation.
  assert.deepEqual(events, [["scrub", "/reset-password"]]);
  assert.equal(f.find("input", (node) => node.props.id === "new-pw").props.minLength, 12);
  await f.input("new-pw", "a strong new password");
  await f.input("confirm-pw", "a strong new password");
  await f.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(events[1])), [
    "submit",
    "/api/auth/recovery/reset",
    { token, password: "a strong new password" },
  ]);
  assert.ok(!f.text().includes(token));
});

for (const [suffix, mode, scrubFails] of [
  [`?token=${token}`, "dual", false],
  [`#token=${token}&token=${token}`, "kova", false],
  [`#token=${token}`, "kova", true],
  ["", "kova", false],
  [`#token=${token}`, "supabase", false],
]) {
  test(`the actual recovery page rejects invalid/unscrubbable authority without hosted fallback (${mode},${suffix.length},${scrubFails})`, async () => {
    const { f, events } = page(suffix, mode, scrubFails);
    await f.flush();
    assert.match(f.text(), /invalid or has expired/u);
    assert.equal(
      f.nodes().some((node) => node.type === "form"),
      false,
    );
    assert.equal(
      events.some(([kind]) => kind === "submit"),
      false,
    );
  });
}
