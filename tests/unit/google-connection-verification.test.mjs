import assert from "node:assert/strict";
import test from "node:test";
import { verifyGoogleServiceRead } from "../../src/lib/google-connection-verification.mjs";

const accountId = "123e4567-e89b-42d3-a456-426614174000";
const unexpected = () => {
  throw new Error("unrelated-service-called");
};

test("Gmail verification makes an authenticated bounded read without retaining message content", async () => {
  const calls = [];
  const actual = await verifyGoogleServiceRead("gmail", accountId, {
    gmailSearch: async (...args) => {
      calls.push(args);
      return { messages: [{ id: "private", body: "secret" }] };
    },
    calendarList: unexpected,
    driveSearch: unexpected,
  });
  assert.deepEqual(calls, [["in:anywhere", 1, accountId]]);
  assert.deepEqual(actual, { service: "gmail", verified: true });
  assert.doesNotMatch(JSON.stringify(actual), /secret|private/);
});

test("Calendar and Drive verification require real account-bound read responses", async () => {
  const calendarArgs = [];
  const driveArgs = [];
  const api = {
    gmailSearch: unexpected,
    calendarList: async (...args) => {
      calendarArgs.push(args);
      return { events: [] };
    },
    driveSearch: async (...args) => {
      driveArgs.push(args);
      return { files: [] };
    },
  };
  assert.deepEqual(await verifyGoogleServiceRead("google-calendar", accountId, api), {
    service: "google-calendar",
    verified: true,
  });
  assert.deepEqual(await verifyGoogleServiceRead("google-drive", accountId, api), {
    service: "google-drive",
    verified: true,
  });
  assert.deepEqual(calendarArgs, [[{ maxResults: 1, connectionId: accountId }]]);
  assert.deepEqual(driveArgs, [["Kova connection verification", 1, accountId]]);
});

test("OAuth-only status, other services, missing owners and invalid API responses never verify", async () => {
  const api = {
    gmailSearch: async () => ({ connected: true }),
    calendarList: async () => ({ events: "not-an-array" }),
    driveSearch: async () => {
      throw new Error("connection_permission_required");
    },
  };
  await assert.rejects(
    verifyGoogleServiceRead("gmail", accountId, api),
    /google_verification_invalid_response/,
  );
  await assert.rejects(
    verifyGoogleServiceRead("google-calendar", accountId, api),
    /google_verification_invalid_response/,
  );
  await assert.rejects(
    verifyGoogleServiceRead("google-drive", accountId, api),
    /connection_permission_required/,
  );
  await assert.rejects(
    verifyGoogleServiceRead("google", accountId, api),
    /unsupported_google_verification/,
  );
  await assert.rejects(
    verifyGoogleServiceRead("gmail", "another-owner", api),
    /invalid_google_connection/,
  );
  await assert.rejects(
    verifyGoogleServiceRead("gmail", accountId, null),
    /google_verification_unavailable/,
  );
});
