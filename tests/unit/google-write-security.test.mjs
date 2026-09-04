import assert from "node:assert/strict";
import test from "node:test";

import { BoundedJsonError, readBoundedJsonObject } from "../../src/lib/bounded-json.server.mjs";
import {
  encodeMimeTextBody,
  foldEmailAddressHeader,
  GoogleWriteValidationError,
  validateSupportedGoogleWrite,
} from "../../src/lib/google-write-validation.server.mjs";

async function expectBodyError(request, code, status, maxBytes = 64) {
  await assert.rejects(
    readBoundedJsonObject(request, maxBytes),
    (error) => error instanceof BoundedJsonError && error.code === code && error.status === status,
  );
}

test("bounded JSON rejects oversized streamed bodies even when content-length is absent", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"value":"'));
      controller.enqueue(encoder.encode("x".repeat(100)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
  const request = new Request("https://kovagpt.com/api/google/gmail", {
    method: "POST",
    body,
    duplex: "half",
  });
  await expectBodyError(request, "request_too_large", 413);
});

test("bounded JSON counts bytes instead of trusting a spoofed short content-length", async () => {
  const request = new Request("https://kovagpt.com/api/google/calendar", {
    method: "POST",
    headers: { "content-length": "2" },
    body: JSON.stringify({ value: "x".repeat(100) }),
  });
  await expectBodyError(request, "request_too_large", 413);
});

test("bounded JSON rejects malformed content-length and invalid JSON deterministically", async () => {
  await expectBodyError(
    new Request("https://kovagpt.com/api/chat/confirm", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
      body: "{}",
    }),
    "invalid_content_length",
    400,
  );
  await expectBodyError(
    new Request("https://kovagpt.com/api/chat/confirm", {
      method: "POST",
      body: "{",
    }),
    "invalid_json",
    400,
  );
});

test("bounded JSON rejects invalid UTF-8 and non-object payloads", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([0xc3, 0x28]));
      controller.close();
    },
  });
  await expectBodyError(
    new Request("https://kovagpt.com/api/chat/confirm", {
      method: "POST",
      body,
      duplex: "half",
    }),
    "invalid_utf8",
    400,
  );
  await expectBodyError(
    new Request("https://kovagpt.com/api/chat/confirm", {
      method: "POST",
      body: "[]",
    }),
    "invalid_json",
    400,
  );
});

test("draft validation blocks CRLF injection in every MIME header", () => {
  const base = {
    to: "owner@example.com",
    subject: "Status",
    body: "Safe body",
  };
  for (const [field, value] of [
    ["to", "owner@example.com\r\nBcc: attacker@example.com"],
    ["cc", "copy@example.com\nBcc: attacker@example.com"],
    ["bcc", "hidden@example.com\rX-Test: injected"],
    ["subject", "Status\r\nBcc: attacker@example.com"],
  ]) {
    assert.throws(
      () =>
        validateSupportedGoogleWrite("gmail_create_draft", {
          ...base,
          [field]: value,
        }),
      GoogleWriteValidationError,
      field,
    );
  }
});

test("draft validation normalizes and validates to, cc, and bcc together", () => {
  const result = validateSupportedGoogleWrite("gmail_create_draft", {
    to: "first@example.com, second@example.org",
    cc: "copy@example.net",
    bcc: "hidden@example.co.uk",
    subject: "  Status update  ",
    body: "Safe body",
    unexpected: "not persisted",
  });
  assert.deepEqual(result, {
    to: "first@example.com, second@example.org",
    cc: "copy@example.net",
    bcc: "hidden@example.co.uk",
    subject: "Status update",
    body: "Safe body",
  });

  for (const field of ["to", "cc", "bcc"]) {
    assert.throws(
      () =>
        validateSupportedGoogleWrite("gmail_create_draft", {
          to: "owner@example.com",
          subject: "Status",
          body: "Safe body",
          [field]: "not-an-email",
        }),
      GoogleWriteValidationError,
      field,
    );
  }
});

test("draft validation caps total recipients and relevant field lengths", () => {
  const recipients = Array.from({ length: 25 }, (_, index) => `person${index}@example.com`);
  assert.throws(
    () =>
      validateSupportedGoogleWrite("gmail_create_draft", {
        to: recipients.join(","),
        cc: "extra@example.com",
        subject: "Status",
        body: "Safe body",
      }),
    /25 total recipients/,
  );
  assert.throws(
    () =>
      validateSupportedGoogleWrite("gmail_create_draft", {
        to: "owner@example.com",
        subject: "x".repeat(301),
        body: "Safe body",
      }),
    GoogleWriteValidationError,
  );
});

test("confirmed send validation uses the same strict MIME envelope as drafts", () => {
  const result = validateSupportedGoogleWrite("gmail_send", {
    to: "recipient@example.com",
    cc: "copy@example.net",
    subject: "  Release update  ",
    body: "The release is ready.",
    ignored: "never persisted",
  });
  assert.deepEqual(result, {
    to: "recipient@example.com",
    cc: "copy@example.net",
    subject: "Release update",
    body: "The release is ready.",
  });
  assert.throws(
    () =>
      validateSupportedGoogleWrite("gmail_send", {
        to: "recipient@example.com\r\nBcc: attacker@example.com",
        subject: "Release update",
        body: "Unsafe",
      }),
    GoogleWriteValidationError,
  );
});

test("recipient headers fold at address boundaries below the MIME hard limit", () => {
  const recipients = Array.from(
    { length: 20 },
    (_, index) => `person-${String(index + 1).padStart(2, "0")}@example.com`,
  ).join(", ");
  const folded = foldEmailAddressHeader("To", recipients);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => line.length <= 78));
  assert.ok(lines.slice(1).every((line) => line.startsWith(" ")));
  assert.equal(folded.replace(/\r\n /g, " "), `To: ${recipients}`);
  assert.throws(
    () => foldEmailAddressHeader("To", "recipient@example.com\r\nBcc: attacker@example.com"),
    GoogleWriteValidationError,
  );
});

test("MIME text bodies use transport-safe base64 lines without data loss", () => {
  const body = `Release notes: ${"🚀 alpha beta ".repeat(500)}`;
  const encoded = encodeMimeTextBody(body);
  assert.ok(encoded.split("\r\n").every((line) => line.length <= 76));
  assert.equal(Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8"), body);
});

test("calendar validation is strict, bounded, and removes unexpected fields", () => {
  const result = validateSupportedGoogleWrite("calendar_create_event", {
    summary: "  Review  ",
    start: "2026-08-02T10:00:00Z",
    end: "2026-08-02T10:30:00Z",
    attendees: ["person@example.com"],
    timezone: "UTC",
    unexpected: "not persisted",
  });
  assert.deepEqual(result, {
    summary: "Review",
    start: "2026-08-02T10:00:00.000Z",
    end: "2026-08-02T10:30:00.000Z",
    attendees: ["person@example.com"],
    timezone: "UTC",
  });
  assert.throws(
    () =>
      validateSupportedGoogleWrite("calendar_create_event", {
        summary: "Review",
        start: "2026-08-02T10:00:00Z",
        attendees: ["person@example.com\r\nBcc: attacker@example.com"],
      }),
    GoogleWriteValidationError,
  );
  assert.throws(() => validateSupportedGoogleWrite("gmail_reply", {}), /not supported/);
});

test("calendar validation requires real RFC 3339 instants with explicit timezones", () => {
  for (const start of [
    "2026-08-02",
    "2026-08-02T10:00:00",
    "2026-02-30T10:00:00Z",
    "2026-08-02T10:00:00+15:00",
    "2026-08-02T24:00:00Z",
  ]) {
    assert.throws(
      () =>
        validateSupportedGoogleWrite("calendar_create_event", {
          summary: "Review",
          start,
        }),
      GoogleWriteValidationError,
      start,
    );
  }
  assert.equal(
    validateSupportedGoogleWrite("calendar_create_event", {
      summary: "Review",
      start: "2026-08-02T10:00:00-07:00",
    }).start,
    "2026-08-02T17:00:00.000Z",
  );
});
