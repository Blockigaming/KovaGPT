import assert from "node:assert/strict";
import test from "node:test";

import {
  parseResendWebhookEvent,
  ResendWebhookError,
  sha256Text,
  verifyResendWebhookSignature,
} from "../../src/lib/resend-webhook.mjs";

const rawSecret = new Uint8Array(32).fill(7);
const secret = `whsec_${Buffer.from(rawSecret).toString("base64")}`;

async function signature(deliveryId, timestamp, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    rawSecret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const value = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${deliveryId}.${timestamp}.${body}`),
  );
  return `v1,${Buffer.from(value).toString("base64")}`;
}

test("Resend signature verification binds delivery, timestamp, and exact body", async () => {
  const deliveryId = "msg_delivery_123";
  const timestamp = "1788498000";
  const body = '{"type":"email.bounced"}';
  const signed = await signature(deliveryId, timestamp, body);

  assert.equal(
    await verifyResendWebhookSignature({
      secret,
      deliveryId,
      timestamp,
      signature: `v0,ignored ${signed}`,
      body,
      now: Number(timestamp) * 1000,
    }),
    true,
  );
  await assert.rejects(
    verifyResendWebhookSignature({
      secret,
      deliveryId,
      timestamp,
      signature: signed,
      body: `${body} `,
      now: Number(timestamp) * 1000,
    }),
    (error) =>
      error instanceof ResendWebhookError && error.code === "invalid_resend_signature",
  );
});

test("Resend verification rejects stale deliveries and missing server secrets", async () => {
  const deliveryId = "msg_delivery_123";
  const timestamp = "1788498000";
  const body = "{}";
  const signed = await signature(deliveryId, timestamp, body);

  await assert.rejects(
    verifyResendWebhookSignature({
      secret,
      deliveryId,
      timestamp,
      signature: signed,
      body,
      now: (Number(timestamp) + 301) * 1000,
    }),
    (error) =>
      error instanceof ResendWebhookError && error.code === "expired_resend_webhook",
  );
  await assert.rejects(
    verifyResendWebhookSignature({
      secret: undefined,
      deliveryId,
      timestamp,
      signature: signed,
      body,
      now: Number(timestamp) * 1000,
    }),
    (error) =>
      error instanceof ResendWebhookError &&
      error.code === "resend_webhook_verification_unavailable" &&
      error.status === 503,
  );
});

test("Resend event parsing retains only trusted reconciliation identifiers", async () => {
  const value = parseResendWebhookEvent({
    type: "email.complained",
    created_at: "2026-09-04T05:00:00.000Z",
    data: {
      email_id: "provider_123",
      to: ["attacker-controlled@example.com"],
      subject: "not persisted",
    },
  });
  assert.deepEqual(value, {
    type: "email.complained",
    providerMessageId: "provider_123",
    occurredAt: "2026-09-04T05:00:00.000Z",
  });
  assert.equal(
    await sha256Text("same payload"),
    await sha256Text("same payload"),
  );
  assert.notEqual(
    await sha256Text("same payload"),
    await sha256Text("different payload"),
  );
  assert.throws(
    () =>
      parseResendWebhookEvent({
        type: "email.complained",
        created_at: "invalid",
        data: { email_id: "provider_123" },
      }),
    (error) =>
      error instanceof ResendWebhookError &&
      error.code === "invalid_resend_webhook_payload",
  );
});
