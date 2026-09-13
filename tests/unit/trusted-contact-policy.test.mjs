import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTrustedContactCommand,
  needsTrustedContactActivation,
  deliverTrustedContactNotification,
  TRUSTED_CONTACT_POLICY_VERSION,
} from "../../src/lib/trusted-contact-policy.mjs";
const id = "11111111-1111-4111-8111-111111111111";
test("commands require explicit versioned consent, bounded identity and a distinct acceptance token", () => {
  const invite = {
    action: "invite",
    id,
    recipientEmail: " Person@Kova.test ",
    consent: true,
    policyVersion: TRUSTED_CONTACT_POLICY_VERSION,
    actor: "spoofed",
  };
  const value = parseTrustedContactCommand(invite);
  assert.equal(value.recipientEmail, "person@kova.test");
  assert.equal(value.actor, undefined);
  for (const change of [
    { consent: false },
    { policyVersion: "unapproved" },
    { recipientEmail: "invalid" },
    { id: "bad" },
  ])
    assert.throws(() => parseTrustedContactCommand({ ...invite, ...change }));
  const accept = {
    action: "accept",
    id,
    commandId: id,
    revision: 2,
    consent: true,
    policyVersion: TRUSTED_CONTACT_POLICY_VERSION,
    token: "a".repeat(64),
  };
  assert.equal(parseTrustedContactCommand(accept).action, "accept");
  for (const change of [{ consent: false }, { token: "short" }, { revision: 1.5 }])
    assert.throws(() => parseTrustedContactCommand({ ...accept, ...change }));
  for (const action of ["decline", "revoke", "block", "remove", "unblock"])
    assert.equal(needsTrustedContactActivation(action), false);
});
test("external notification delivery is off by default and requires an explicit user action plus fresh consent state", async () => {
  let reads = 0,
    sends = 0;
  const invitation = {
    id,
    revision: 1,
    state: "pending",
    inviter_id: "sender",
    recipient_id: "recipient",
    inviter_consented_at: "now",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    token: "must not send",
  };
  const input = {
    invitation,
    readCurrent: async () => {
      reads++;
      return invitation;
    },
    deliver: async (payload) => {
      sends++;
      assert.equal(payload.token, undefined);
      assert.deepEqual(Object.keys(payload).sort(), ["event", "invitationId", "recipientId"]);
    },
  };
  assert.equal((await deliverTrustedContactNotification(input)).state, "disabled");
  assert.equal(reads, 0);
  assert.equal(sends, 0);
  assert.equal(
    (await deliverTrustedContactNotification({ ...input, enabled: true })).state,
    "disabled",
  );
  assert.equal(
    (await deliverTrustedContactNotification({ ...input, enabled: true, explicitUserAction: true }))
      .state,
    "sent",
  );
  assert.equal(sends, 1);
  for (const change of [
    { revision: 2 },
    { state: "revoked" },
    { expires_at: "invalid" },
    { inviter_consented_at: null },
  ])
    assert.equal(
      (
        await deliverTrustedContactNotification({
          ...input,
          enabled: true,
          explicitUserAction: true,
          readCurrent: async () => ({ ...invitation, ...change }),
        })
      ).state,
      "unavailable",
    );
  assert.equal(sends, 1);
});
