import assert from "node:assert/strict";
import test from "node:test";
import { renderKovaAuthEmail } from "../../src/lib/kova-auth-email.server.mjs";

const base = {
  label: "kova-auth-verification",
  recipient: "fixture-owner@example.test",
  link: `https://app.example.test/api/auth/verify?token=${"V".repeat(43)}`,
  publicOrigin: "https://app.example.test",
  issuedAt: "2026-10-19T22:00:00.000Z",
  expiresAt: "2026-10-19T23:00:00.000Z",
};

test("verification is branded HTML and plain text with the actual one-hour expiry", () => {
  const result = renderKovaAuthEmail(base);
  assert.equal(result.subject, "Verify your KovaGPT email");
  for (const output of [result.html, result.text]) {
    assert.match(output, /1 hour after it was requested/);
    assert.match(output, /2026-10-19 23:00:00 UTC/);
    assert.match(output, /used once/);
    assert.match(output, /support@kovagpt\.com/);
  }
  assert.match(result.html, /<html lang="en"/);
  assert.match(result.html, /role="presentation"/);
  assert.doesNotMatch(result.html, /<img|<script|<iframe|<form/);
  assert.doesNotMatch(result.text, /<html|<p>/);
});

test("recovery uses only the supported fragment route and does not promise a password change", () => {
  const result = renderKovaAuthEmail({
    ...base,
    label: "kova-auth-recovery",
    link: `https://app.example.test/reset-password#token=${"R".repeat(43)}`,
  });
  assert.equal(result.subject, "Reset your KovaGPT password");
  assert.match(result.text, /Your password will stay the same/);
  assert.match(result.html, />Reset password<\/a>/);
});

test("expiry is derived from caller values, not a hardcoded one-hour promise", () => {
  const result = renderKovaAuthEmail({ ...base, expiresAt: "2026-10-19T22:15:00.000Z" });
  assert.match(result.text, /15 minutes after it was requested/);
  assert.doesNotMatch(result.text, /1 hour/);
  for (const expiresAt of ["invalid", base.issuedAt, "2026-10-18T22:00:00Z"]) {
    assert.throws(() => renderKovaAuthEmail({ ...base, expiresAt }), /expiry_invalid/);
  }
});

test("untrusted recipient content is escaped in HTML and header controls are rejected", () => {
  const recipient = "owner+<img src=x onerror='alert(1)'>&\"@example.test";
  const result = renderKovaAuthEmail({ ...base, recipient });
  assert.doesNotMatch(result.html, /<img|onerror='alert/);
  assert.match(result.html, /&lt;img/);
  assert.match(result.html, /&amp;&quot;/);
  assert.ok(result.text.includes(recipient));
  for (const recipient of ["owner@example.test\r\nBcc:other@example.test", "", "x".repeat(321)]) {
    assert.throws(() => renderKovaAuthEmail({ ...base, recipient }), /recipient_invalid/);
  }
});

test("production origin and action route reject credentials, protocols and redirect parameters", () => {
  const token = "V".repeat(43);
  for (const link of [
    `http://app.example.test/api/auth/verify?token=${token}`,
    `https://other.example.test/api/auth/verify?token=${token}`,
    `https://user:password@app.example.test/api/auth/verify?token=${token}`,
    `https://app.example.test/api/auth/verify?token=${token}&next=https://other.example.test`,
    `https://app.example.test/api/auth/verify?token=${token}&token=${token}`,
    `https://app.example.test/api/auth/verify?token=${token}#fragment`,
    `https://app.example.test/reset-password#token=${token}`,
    "javascript:alert(1)",
    "//app.example.test/api/auth/verify",
    "https://app.example.test/api/auth/verify?token=bad",
  ])
    assert.throws(() => renderKovaAuthEmail({ ...base, link }), /link_invalid/);
  for (const publicOrigin of [
    "http://app.example.test",
    "https://app.example.test/",
    "https://user@app.example.test",
    "https://app.example.test/path",
  ]) {
    assert.throws(() => renderKovaAuthEmail({ ...base, publicOrigin }), /origin_invalid/);
  }
});

test("recovery rejects query-token, alternate paths and unsupported lifecycle types", () => {
  const token = "R".repeat(43);
  for (const link of [
    `https://app.example.test/reset-password?token=${token}`,
    `https://app.example.test/reset-password?next=/chat#token=${token}`,
    `https://app.example.test/reset-password#token=${token}&next=/chat`,
    `https://app.example.test/api/auth/verify?token=${token}`,
  ]) {
    assert.throws(
      () => renderKovaAuthEmail({ ...base, label: "kova-auth-recovery", link }),
      /link_invalid/,
    );
  }
  for (const label of ["invite", "magic-link", "__proto__", "toString"]) {
    assert.throws(() => renderKovaAuthEmail({ ...base, label }), /action_unsupported/);
  }
});

test("long addresses, both themes and fallback font behavior are present without network assets", () => {
  const result = renderKovaAuthEmail({
    ...base,
    recipient: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.example.test`,
  });
  assert.match(result.html, /overflow-wrap:anywhere/);
  assert.match(result.html, /word-break:break-all/);
  assert.match(result.html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(result.html, /\[data-ogsc\]/);
  assert.match(result.html, /Helvetica, Arial, sans-serif/);
  assert.match(result.html, /max-width: 620px/);
  assert.doesNotMatch(result.html, /url\(|<img|<link\b/);
});
