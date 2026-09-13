export const TRUSTED_CONTACT_POLICY_VERSION = "trusted-contact-consent-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TOKEN = /^[a-f0-9]{64}$/u;
export function parseTrustedContactCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_contact_command");
  const { action } = value;
  if (action === "invite") {
    if (
      !UUID.test(value.id ?? "") ||
      typeof value.recipientEmail !== "string" ||
      value.recipientEmail.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.recipientEmail.trim()) ||
      value.consent !== true ||
      value.policyVersion !== TRUSTED_CONTACT_POLICY_VERSION
    )
      throw new Error("invalid_contact_command");
    return {
      action,
      id: value.id,
      recipientEmail: value.recipientEmail.trim().toLowerCase(),
      consent: true,
      policyVersion: TRUSTED_CONTACT_POLICY_VERSION,
    };
  }
  if (action === "unblock") {
    if (
      !UUID.test(value.otherId ?? "") ||
      !UUID.test(value.blockId ?? "") ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1
    )
      throw new Error("invalid_contact_command");
    return { action, otherId: value.otherId, blockId: value.blockId, revision: value.revision };
  }
  if (
    !["review", "accept", "decline", "revoke", "block", "remove"].includes(action) ||
    !UUID.test(value.id ?? "") ||
    !UUID.test(value.commandId ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    throw new Error("invalid_contact_command");
  if (
    action === "accept" &&
    (value.consent !== true ||
      value.policyVersion !== TRUSTED_CONTACT_POLICY_VERSION ||
      !TOKEN.test(value.token ?? ""))
  )
    throw new Error("invalid_contact_command");
  return {
    action,
    id: value.id,
    commandId: value.commandId,
    revision: value.revision,
    ...(action === "accept"
      ? { consent: true, token: value.token, policyVersion: TRUSTED_CONTACT_POLICY_VERSION }
      : {}),
  };
}
export function needsTrustedContactActivation(action) {
  return ["invite", "review", "accept"].includes(action);
}

/** No external delivery implementation is installed or enabled by default. */
export async function deliverTrustedContactNotification({
  enabled = false,
  explicitUserAction = false,
  invitation,
  readCurrent,
  deliver,
}) {
  if (!enabled || !explicitUserAction || typeof deliver !== "function")
    return { state: "disabled" };
  if (typeof readCurrent !== "function" || !invitation) return { state: "unavailable" };
  const current = await readCurrent(invitation.id);
  if (
    !current ||
    current.revision !== invitation.revision ||
    current.state !== "pending" ||
    current.inviter_id !== invitation.inviter_id ||
    current.recipient_id !== invitation.recipient_id ||
    !current.inviter_consented_at ||
    !Number.isFinite(Date.parse(current.expires_at)) ||
    Date.parse(current.expires_at) <= Date.now()
  )
    return { state: "unavailable" };
  // Never provide token material, chat content, or contact-list data to a driver.
  await deliver({
    invitationId: current.id,
    recipientId: current.recipient_id,
    event: "trusted_contact_invitation",
  });
  return { state: "sent" };
}
