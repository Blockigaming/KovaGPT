import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  renderKovaAuthEmail,
  renderPreviousKovaAuthEmail,
  renderLegacyKovaAuthEmail,
} from "../../src/lib/kova-auth-email.server.mjs";
import { validatedAuthEmail } from "../../scripts/auth-email/dispatch.mjs";

for (const label of ["kova-auth-verification", "kova-auth-recovery"]) {
  test(`${label}: current and legacy queued HTML keep exact retry bytes and reject tampering`, () => {
    const token = "A".repeat(43);
    const origin = "https://kovagpt.com";
    const input = {
      label,
      recipient: "preview@example.invalid",
      publicOrigin: origin,
      link: label.endsWith("recovery")
        ? `${origin}/reset-password#token=${token}`
        : `${origin}/api/auth/verify?token=${token}`,
      issuedAt: "2026-10-24T16:00:00.000Z",
      expiresAt: "2026-10-24T17:00:00.000Z",
    };
    const current = renderKovaAuthEmail(input);
    const previous = renderPreviousKovaAuthEmail(input);
    const legacy = renderLegacyKovaAuthEmail(input);
    assert.notEqual(current.html, legacy.html);
    assert.notEqual(current.html, previous.html);
    assert.notEqual(previous.html, legacy.html);
    assert.equal(current.text, legacy.text);
    assert.equal(current.subject, legacy.subject);
    const config = {
      messageIds: ["M".repeat(43)],
      recipients: [input.recipient],
      publicOrigin: origin,
      issuedNotBefore: "2026-10-24T15:59:00.000Z",
    };
    for (const rendered of [current, previous, legacy]) {
      const payload = {
        ...rendered,
        message_id: config.messageIds[0],
        purpose: "auth",
        label,
        from: "KovaGPT <noreply@kovagpt.com>",
        sender_domain: "notify.kovagpt.com",
        to: input.recipient,
        queued_at: input.issuedAt,
        idempotency_key: `${label}:${createHash("sha256").update(token).digest("hex")}`,
      };
      assert.equal(validatedAuthEmail(payload, config).html, rendered.html);
      assert.equal(validatedAuthEmail(payload, config).text, rendered.text);
      assert.throws(() =>
        validatedAuthEmail(
          {
            ...payload,
            html:
              payload.html.replace("Verify email", "Open an unrelated site") +
              "<img src='https://untrusted.invalid/tracker'>",
          },
          config,
        ),
      );
      assert.throws(() =>
        validatedAuthEmail({ ...payload, text: payload.text + "untrusted" }, config),
      );
    }
  });
}
