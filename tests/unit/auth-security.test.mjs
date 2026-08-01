import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAuthenticatedUser,
  isCrossSiteMutation,
  parseBearerToken,
  safeRelativeRedirect,
} from "../../src/lib/auth-security.mjs";
import { BodyReadError, readUtf8BodyBounded } from "../../src/lib/endpoint-reliability.mjs";

test("bearer parsing accepts one token and rejects ambiguous credentials", () => {
  assert.equal(parseBearerToken("Bearer abc.def"), "abc.def");
  assert.equal(parseBearerToken("bearer\tabc"), "abc");
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken("Basic abc"), null);
  assert.equal(parseBearerToken("Bearer"), null);
  assert.equal(parseBearerToken("Bearer one two"), null);
});

test("deleted and actively banned users fail closed", () => {
  const now = Date.parse("2026-08-01T12:00:00Z");
  assert.deepEqual(evaluateAuthenticatedUser(null, {}, now), {
    ok: false,
    status: 401,
    code: "invalid_session",
  });
  assert.deepEqual(evaluateAuthenticatedUser({ id: "user-1", deleted_at: "2026-08-01" }, {}, now), {
    ok: false,
    status: 401,
    code: "invalid_session",
  });
  assert.deepEqual(
    evaluateAuthenticatedUser({ id: "user-1", banned_until: "2026-08-02T12:00:00Z" }, {}, now),
    { ok: false, status: 403, code: "account_suspended" },
  );
  assert.deepEqual(evaluateAuthenticatedUser({ id: "user-1", banned_until: "invalid" }, {}, now), {
    ok: false,
    status: 403,
    code: "account_suspended",
  });
  assert.equal(
    evaluateAuthenticatedUser({ id: "user-1", banned_until: "2026-07-31T12:00:00Z" }, {}, now).ok,
    true,
  );
});

test("verified MFA factors require an aal2 session", () => {
  const user = {
    id: "user-1",
    email_confirmed_at: "2026-08-01T00:00:00Z",
    factors: [{ status: "verified" }],
  };
  assert.deepEqual(evaluateAuthenticatedUser(user, { aal: "aal1" }), {
    ok: false,
    status: 403,
    code: "mfa_required",
  });
  assert.deepEqual(evaluateAuthenticatedUser(user, { aal: "aal2" }), {
    ok: true,
    userId: "user-1",
    emailVerified: true,
    assuranceLevel: "aal2",
  });
  assert.equal(
    evaluateAuthenticatedUser(
      { id: "user-1", factors: [{ status: "unverified" }] },
      { aal: "aal1" },
    ).ok,
    true,
  );
});

test("mutation origin checks reject cross-origin and opaque browser requests", () => {
  const same = new Request("https://kovagpt.com/api/account", {
    method: "DELETE",
    headers: { origin: "https://kovagpt.com", "sec-fetch-site": "same-origin" },
  });
  const cross = new Request("https://kovagpt.com/api/account", {
    method: "DELETE",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  });
  const sibling = new Request("https://kovagpt.com/api/account", {
    method: "DELETE",
    headers: {
      origin: "https://app.kovagpt.com",
      "sec-fetch-site": "same-site",
    },
  });
  const opaque = new Request("https://kovagpt.com/api/account", {
    method: "DELETE",
    headers: { origin: "null" },
  });
  const nonBrowser = new Request("https://kovagpt.com/api/account", {
    method: "DELETE",
  });
  assert.equal(isCrossSiteMutation(same), false);
  assert.equal(isCrossSiteMutation(cross), true);
  assert.equal(isCrossSiteMutation(sibling), true);
  assert.equal(isCrossSiteMutation(opaque), true);
  assert.equal(isCrossSiteMutation(nonBrowser), false);
  assert.equal(
    isCrossSiteMutation(
      new Request("https://kovagpt.com/api/account", {
        method: "GET",
        headers: { origin: "https://evil.example" },
      }),
    ),
    false,
  );
});

test("post-auth redirects stay on the current origin", () => {
  const base = "https://kovagpt.com";
  assert.equal(safeRelativeRedirect("/projects/123?q=1#chat", base), "/projects/123?q=1#chat");
  assert.equal(safeRelativeRedirect("//evil.example/path", base), "/");
  assert.equal(safeRelativeRedirect("/\\evil.example/path", base), "/");
  assert.equal(safeRelativeRedirect("https://evil.example/path", base), "/");
  assert.equal(safeRelativeRedirect("/~oauth/callback?code=secret", base), "/");
});

test("bounded UTF-8 reader rejects invalid lengths, oversize streams, and invalid UTF-8", async () => {
  await assert.rejects(
    readUtf8BodyBounded(
      new Request("https://kovagpt.com/api/account", {
        method: "DELETE",
        headers: { "content-length": "not-a-number" },
        body: "{}",
      }),
      32,
    ),
    (error) => error instanceof BodyReadError && error.status === 400,
  );
  await assert.rejects(
    readUtf8BodyBounded(
      new Request("https://kovagpt.com/api/account", {
        method: "DELETE",
        body: "😀😀😀",
      }),
      8,
    ),
    (error) => error instanceof BodyReadError && error.status === 413,
  );
  await assert.rejects(
    readUtf8BodyBounded(
      new Request("https://kovagpt.com/api/account", {
        method: "DELETE",
        body: new Uint8Array([0xc3, 0x28]),
      }),
      8,
    ),
    (error) => error instanceof BodyReadError && error.status === 400,
  );
});
