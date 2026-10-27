import assert from "node:assert/strict";
import test from "node:test";
import { renderKovaAccountEmail } from "../../src/lib/kova-account-email.server.mjs";

const base = {
  event: "password_changed",
  publicOrigin: "https://app.example.test",
  occurredAt: "2026-10-20T12:34:56.000Z",
};
const events = [
  "password_changed",
  "security_method_added",
  "security_method_changed",
  "security_method_removed",
  "account_deletion_scheduled",
  "account_deleted",
  "new_login",
  "email_changed",
  "account_recovered",
  "welcome",
];

test("each supported account event renders meaningful HTML and plain text without remote assets", () => {
  const subjects = new Set();
  for (const event of events) {
    const result = renderKovaAccountEmail({
      ...base,
      event,
      ...(event === "account_deletion_scheduled"
        ? { deletionScheduledFor: "2026-11-19T12:34:56.000Z" }
        : {}),
    });
    subjects.add(result.subject);
    assert.match(result.subject, /KovaGPT/);
    assert.match(result.html, /<html lang="en"/);
    assert.match(result.html, /<h1\b/);
    assert.match(result.html, /role="presentation"/);
    assert.match(result.html, /2026-10-20 12:34:56 UTC/);
    assert.match(result.text, /2026-10-20 12:34:56 UTC/);
    assert.match(result.text, /support@kovagpt\.com/);
    assert.doesNotMatch(result.text, /<html|<p>|<table/);
    assert.doesNotMatch(result.html, /<script|<iframe|<img|<form|<link\b|url\(/);
  }
  assert.equal(subjects.size, events.length);
});

test("security notices tell the user what to do without inventing location or device evidence", () => {
  for (const event of [
    "password_changed",
    "security_method_added",
    "security_method_changed",
    "security_method_removed",
    "new_login",
    "email_changed",
  ]) {
    const result = renderKovaAccountEmail({ ...base, event });
    assert.match(result.text, /If this was not you/);
    assert.match(result.text, /https:\/\/app\.example\.test\/auth/);
    assert.doesNotMatch(result.text, /IP address|Location:|Device:|Chrome|Safari|Windows/);
    assert.match(result.text, /never ask you to reply with your password/);
  }
});

test("scheduled deletion uses only the supplied recovery deadline and preserves billing/recovery terms", () => {
  const result = renderKovaAccountEmail({
    ...base,
    event: "account_deletion_scheduled",
    deletionScheduledFor: "2026-11-19T12:34:56.000Z",
  });
  assert.match(result.text, /30-day recovery period/);
  assert.match(result.text, /Recovery deadline: 2026-11-19 12:34:56 UTC/);
  assert.match(result.text, /Settings → Data controls/);
  assert.match(result.text, /does not cancel billing/);
  assert.doesNotMatch(result.text, /has been deleted|permanently erased/);
  for (const deletionScheduledFor of [
    undefined,
    "invalid",
    base.occurredAt,
    "2026-10-19T12:34:56.000Z",
    '<img src=x onerror="alert(1)">',
  ]) {
    assert.throws(() =>
      renderKovaAccountEmail({
        ...base,
        event: "account_deletion_scheduled",
        deletionScheduledFor,
      }),
    );
  }
});

test("completed deletion is distinct from scheduling and does not promise removal of retained records", () => {
  const result = renderKovaAccountEmail({ ...base, event: "account_deleted" });
  assert.match(result.text, /account has been deleted/);
  assert.match(result.text, /legal or security obligations may remain/);
  assert.doesNotMatch(result.text, /Recover|30-day|Settings → Notifications/);
  assert.doesNotMatch(result.html, /href="https:\/\/app\.example\.test\/auth"/);
  assert.throws(
    () => renderKovaAccountEmail({ ...base, deletionScheduledFor: "2026-11-19T12:34:56.000Z" }),
    /deletion_deadline_unexpected/,
  );
});

test("URLs are generated only from an exact HTTPS origin and fixed existing application paths", () => {
  for (const publicOrigin of [
    undefined,
    null,
    123,
    "",
    "http://app.example.test",
    "https://app.example.test/",
    "https://user:password@app.example.test",
    "https://app.example.test/path",
    "https://app.example.test?next=https://other.example.test",
    "https://app.example.test#fragment",
    "javascript:alert(1)",
    "//app.example.test",
    "https://app.example.test\r\nBcc:other@example.test",
  ]) {
    assert.throws(() => renderKovaAccountEmail({ ...base, publicOrigin }), /origin_invalid/);
  }
  const result = renderKovaAccountEmail({
    ...base,
    subject: "Injected subject",
    introduction: '<img src=x onerror="alert(1)">',
    actionUrl: "https://other.example.test",
    link: "javascript:alert(1)",
    token: "a-secret-proof-token",
  });
  assert.doesNotMatch(
    result.html + result.text,
    /Injected subject|<img|other\.example|javascript:|a-secret/,
  );
  const hrefs = [...result.html.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(hrefs, [
    "https://app.example.test/auth",
    "mailto:support@kovagpt.com",
    "https://app.example.test/privacy",
  ]);
});

test("unknown events and invalid timestamps cannot be converted into successful account notices", () => {
  for (const event of [
    undefined,
    null,
    1,
    ["password_changed"],
    { toString: () => "password_changed" },
    "__proto__",
    "toString",
    "password_reset",
    "<b>changed</b>",
  ]) {
    assert.throws(() => renderKovaAccountEmail({ ...base, event }), /event_unsupported/);
  }
  for (const input of [undefined, null, [], "password_changed"]) {
    assert.throws(() => renderKovaAccountEmail(input), /input_invalid/);
  }
  for (const occurredAt of [
    undefined,
    null,
    0,
    "invalid",
    "2026-10-20",
    "10/20/2026",
    "2026-13-20T12:00:00Z",
    "2026-02-30T12:00:00Z",
    "2026-10-20T24:00:00Z",
  ]) {
    assert.throws(() => renderKovaAccountEmail({ ...base, occurredAt }), /timestamp_invalid/);
  }
  const result = renderKovaAccountEmail({ ...base, occurredAt: "2026-10-20T08:34:56-04:00" });
  assert.match(result.text, /2026-10-20 12:34:56 UTC/);
});

test("the restrained brand adapts to mobile and dark email clients with a readable action", () => {
  const { html } = renderKovaAccountEmail(base);
  assert.match(html, /max-width:560px/);
  assert.match(html, /max-width: 620px/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /\[data-ogsc\]/);
  assert.match(html, /border-radius:10px/);
  assert.match(html, /Helvetica, Arial, sans-serif/);
  assert.match(html, /Manage account email preferences in Settings → Notifications/);
});

test("account notices retain the same visual hierarchy without embedded CSS", () => {
  const html = renderKovaAccountEmail(base).html.replace(/<style>[\s\S]*?<\/style>/u, "");
  assert.match(
    html,
    /<body class="kova-page" style="[^"]*background-color:#f4f4f2;padding:32px 12px;/u,
  );
  assert.match(
    html,
    /<td class="kova-container" style="[^"]*border:1px solid #e5e5e3;border-radius:24px;padding:40px;/u,
  );
  assert.match(html, /<h1 class="kova-heading" style="[^"]*font-size:30px;line-height:1.15;/u);
  assert.match(html, /<a class="kova-button" href="[^"]+" style="[^"]*border-radius:999px;/u);
});
