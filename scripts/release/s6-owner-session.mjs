/** One headed owner session. No virtual authenticator or Google credential automation.
 * Physical ceremonies and Google sign-in/consent occur in the visible browser;
 * all API, replay, identity, MFA and removal assertions execute automatically.
 * Never enable trace, HAR, video, or request logging for this session.
 */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { ORIGIN, totp } from "./s6-deployed-checks.mjs";

export async function ownerSession({ page, expectedEmail, deadline, sourceSha }) {
  const receipts = [];
  let principal, totpSecret, recoveryCodes, factorId, passkeyId;
  let callbackRequest;
  const request = page.context().request;
  const guard = () =>
    assert.ok(Date.now() < deadline - 180000, "owner-session time reserve reached");
  const api = async (path, body, extra = {}) => {
    guard();
    const headers = {
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      ...(principal
        ? {
            "X-Kova-Owner": principal.accountId,
            "X-Kova-Session": principal.sessionId,
          }
        : {}),
      ...extra,
    };
    const r = await request.fetch(ORIGIN + path, {
      method: body === undefined ? "GET" : "POST",
      data: body,
      headers,
      timeout: 12000,
      maxRedirects: 0,
    });
    let data;
    try {
      data = await r.json();
    } catch {}
    return { status: r.status(), data, headers: r.headers() };
  };
  const session = async () => {
    const r = await api("/api/auth/session");
    assert.equal(r.status, 200);
    assert.equal(r.data.session.email.toLowerCase(), expectedEmail);
    principal = r.data.session;
    return principal;
  };
  const logout = async () => {
    if (principal) {
      assert.equal((await api("/api/auth/logout", {})).status, 204);
      principal = undefined;
    }
  };
  const record = (check, assertions) =>
    receipts.push({
      check,
      status: "PASS",
      kind: "DEPLOYED",
      at: new Date().toISOString(),
      sourceSha,
      assertions,
    });
  page.on("request", (r) => {
    if (r.url().startsWith(ORIGIN + "/api/auth/google/callback?")) callbackRequest = r;
  });
  async function google(method) {
    guard();
    await logout();
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.evaluate((origin) => {
      window.location.assign(origin + "/api/auth/google/start?return_to=%2F%3Fs6_owner_return%3D1");
    }, ORIGIN);
    // The owner uses Google normally in this visible browser. No script reads
    // or enters passwords, one-time provider codes, or consent controls.
    await page.waitForURL(
      (u) =>
        u.origin === ORIGIN &&
        (u.searchParams.has("s6_owner_return") || u.searchParams.has("google_mfa")),
      { timeout: Math.min(120000, deadline - 180000 - Date.now()) },
    );
    if (method) {
      assert.equal(new URL(page.url()).searchParams.get("google_mfa"), "1");
      assert.equal((await api("/api/auth/session")).status, 401);
      const proof =
        method === "totp" ? { code: totp(totpSecret) } : { recoveryCode: recoveryCodes[0] };
      const finish = await api("/api/auth/login", { googleMfa: true, ...proof });
      assert.equal(finish.status, 200);
      principal = finish.data.session;
      assert.equal(principal.assuranceLevel, "aal2");
      const replay = await api("/api/auth/login", { googleMfa: true, ...proof });
      assert.equal(replay.status, 401);
    }
    await session();
    assert.ok(callbackRequest);
    const captured = callbackRequest;
    callbackRequest = undefined;
    const replay = await request.get(captured.url(), {
      headers: { cookie: (await captured.allHeaders()).cookie ?? "" },
      maxRedirects: 0,
      timeout: 12000,
    });
    assert.equal(replay.status(), 303);
    assert.match(replay.headers().location, /google_invalid_state|google_exchange_failed/);
    assert.ok(!replay.headers()["set-cookie"]?.includes("__Host-kova_session="));
  }
  function clientData(response) {
    return JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString());
  }
  async function physical(kind, options) {
    guard();
    options = {
      ...options,
      timeout: Math.min(options.timeout ?? 60000, 120000, deadline - 180000 - Date.now()),
    };
    return page.evaluate(
      async ({ kind, options }) => {
        const decode = (s) =>
          Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
            c.charCodeAt(0),
          );
        const encode = (b) =>
          btoa(String.fromCharCode(...new Uint8Array(b)))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", "");
        const publicKey = { ...options, challenge: decode(options.challenge) };
        if (kind === "create") {
          publicKey.user = { ...options.user, id: decode(options.user.id) };
          publicKey.excludeCredentials = (options.excludeCredentials ?? []).map((c) => ({
            ...c,
            id: decode(c.id),
          }));
        } else
          publicKey.allowCredentials = (options.allowCredentials ?? []).map((c) => ({
            ...c,
            id: decode(c.id),
          }));
        // This invokes the real authenticator. The owner completes user verification.
        const credential = await navigator.credentials[kind]({ publicKey });
        if (!credential) throw new Error("physical_credential_unavailable");
        const r = credential.response;
        return {
          id: credential.id,
          rawId: encode(credential.rawId),
          type: credential.type,
          clientExtensionResults: credential.getClientExtensionResults(),
          authenticatorAttachment: credential.authenticatorAttachment,
          response:
            kind === "create"
              ? {
                  clientDataJSON: encode(r.clientDataJSON),
                  attestationObject: encode(r.attestationObject),
                  transports: r.getTransports(),
                }
              : {
                  clientDataJSON: encode(r.clientDataJSON),
                  authenticatorData: encode(r.authenticatorData),
                  signature: encode(r.signature),
                  userHandle: r.userHandle ? encode(r.userHandle) : null,
                },
        };
      },
      { kind, options },
    );
  }
  try {
    const crossSite = await api("/api/auth/google/start", undefined, {
      Origin: "https://untrusted.invalid",
      "Sec-Fetch-Site": "cross-site",
    });
    assert.equal(crossSite.status, 403);
    await google();
    assert.equal(principal.assuranceLevel, "aal1");
    const owner = principal.accountId;
    const inventory = await api("/api/auth/passkeys");
    assert.equal(inventory.status, 200);
    assert.equal(inventory.data.passkeys.length, 0, "fixture must have no existing passkeys");
    const registration = await api("/api/auth/passkeys/register/options", {
      friendlyName: "S6 disposable physical passkey",
    });
    assert.equal(registration.status, 200);
    assert.equal(registration.data.options.rp.id, new URL(ORIGIN).hostname);
    assert.equal(registration.data.options.authenticatorSelection.userVerification, "required");
    const attestation = await physical("create", registration.data.options);
    assert.equal(clientData(attestation).origin, ORIGIN);
    const registrationBody = {
      challengeToken: registration.data.challengeToken,
      response: attestation,
    };
    const registered = await api("/api/auth/passkeys/register/verify", registrationBody);
    assert.equal(registered.status, 200);
    principal = registered.data.session;
    assert.equal(principal.accountId, owner);
    assert.equal((await api("/api/auth/passkeys/register/verify", registrationBody)).status, 401);
    const listed = await api("/api/auth/passkeys");
    assert.equal(listed.data.passkeys.length, 1);
    passkeyId = listed.data.passkeys[0].id;
    assert.equal(
      (
        await api("/api/auth/passkeys/rename", {
          passkeyId,
          friendlyName: "S6 renamed physical passkey",
        })
      ).data.renamed,
      true,
    );
    assert.equal(
      (await api("/api/auth/passkeys")).data.passkeys[0].friendlyName,
      "S6 renamed physical passkey",
    );
    record("passkey_registration", [
      "physical authenticator with required user verification",
      "exact RP ID and origin",
      "same account after registration",
      "registration replay denied",
    ]);
    await logout();
    const options = await api("/api/auth/passkeys/login/options", {});
    assert.equal(options.status, 200);
    assert.equal(options.data.options.rpId, new URL(ORIGIN).hostname);
    const assertion = await physical("get", options.data.options);
    assert.equal(clientData(assertion).origin, ORIGIN);
    const body = { challengeToken: options.data.challengeToken, response: assertion };
    const logged = await api("/api/auth/passkeys/login/verify", body);
    assert.equal(logged.status, 200);
    principal = logged.data.session;
    assert.equal(principal.accountId, owner);
    assert.equal(principal.assuranceLevel, "aal2");
    assert.equal((await api("/api/auth/passkeys/login/verify", body)).status, 401);
    const enrollment = await api("/api/auth/mfa/enroll", {
      friendlyName: "Disposable S6 Google factor",
    });
    assert.equal(enrollment.status, 200);
    totpSecret = enrollment.data.secret;
    factorId = enrollment.data.factorId;
    const activated = await api("/api/auth/mfa/verify", { factorId, code: totp(totpSecret) });
    assert.equal(activated.status, 200);
    principal = activated.data.session;
    recoveryCodes = activated.data.recoveryCodes;
    // Capture a fresh, genuinely signed assertion BEFORE removal; submitting it
    // after removal tests revoked-key lookup instead of only challenge replay.
    const pending = await api("/api/auth/passkeys/login/options", {});
    const signedBeforeRemoval = await physical("get", pending.data.options);
    const removed = await api("/api/auth/passkeys/remove", { passkeyId, confirm: true });
    assert.equal(removed.status, 200);
    principal = removed.data.session;
    passkeyId = undefined;
    assert.equal(
      (
        await api("/api/auth/passkeys/login/verify", {
          challengeToken: pending.data.challengeToken,
          response: signedBeforeRemoval,
        })
      ).status,
      401,
    );
    assert.equal((await api("/api/auth/passkeys")).data.passkeys.length, 0);
    record("passkey_login_and_removal", [
      "physical login to same account at AAL2",
      "rename persisted",
      "login challenge replay denied",
      "fresh signed assertion denied after credential removal",
    ]);
    await google("totp");
    await google("recovery");
    const remove = await api("/api/auth/mfa/remove", { factorId });
    assert.equal(remove.status, 200);
    principal = remove.data.session;
    assert.equal(
      (await api("/api/auth/mfa/verify", { factorId, code: totp(totpSecret) })).status,
      401,
    );
    factorId = undefined;
    record("google_callback_and_consent", [
      "real Google consent/callback to dedicated fixture",
      "no-MFA AAL1",
      "Google plus TOTP AAL2",
      "Google plus recovery AAL2",
      "callback and challenge replay denied",
      "revoked factor denied",
    ]);
    return receipts;
  } finally {
    if (principal && passkeyId)
      await api("/api/auth/passkeys/remove", { passkeyId, confirm: true }).catch(() => {});
    if (principal && factorId) await api("/api/auth/mfa/remove", { factorId }).catch(() => {});
    await logout().catch(() => {});
    totpSecret = undefined;
    recoveryCodes = undefined;
  }
}

async function main() {
  const [flag, baselinePath, receiptPath] = process.argv.slice(2);
  assert.equal(flag, "--owner-authorized");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.equal(baseline.origin, ORIGIN);
  assert.equal(baseline.existingAccounts, 0);
  assert.equal(baseline.existingHostedUsers, 0);
  assert.equal(baseline.authorizedDisposableGoogleIdentity, true);
  assert.ok(Date.now() - Date.parse(baseline.capturedAt) < 300000);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  try {
    const receipts = await ownerSession({ page, ...baseline });
    writeFileSync(receiptPath, JSON.stringify(receipts, null, 2), { mode: 0o600 });
  } finally {
    await context.close();
    await browser.close();
  }
}
if (process.argv.includes("--owner-authorized"))
  main().catch((error) => {
    console.error(JSON.stringify({ status: "FAILED", errorType: error.name }));
    process.exitCode = 2;
  });
