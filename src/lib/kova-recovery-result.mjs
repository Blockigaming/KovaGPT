export const KOVA_RECOVERY_UNCONFIRMED_MESSAGE =
  "We could not confirm the password update. It may have completed. Try signing in with your new password; otherwise, retry here or request a new reset link.";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
function hasPublicPrincipalShape(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const session = payload.session;
  return (
    session &&
    typeof session === "object" &&
    !Array.isArray(session) &&
    typeof session.accountId === "string" &&
    UUID.test(session.accountId) &&
    typeof session.sessionId === "string" &&
    UUID.test(session.sessionId) &&
    typeof session.email === "string" &&
    session.email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(session.email) &&
    !/[\u0000-\u001f\u007f]/u.test(session.email) &&
    session.emailVerified === true &&
    (session.assuranceLevel === "aal1" || session.assuranceLevel === "aal2") &&
    (session.displayName === undefined ||
      session.displayName === null ||
      typeof session.displayName === "string") &&
    (session.expiresAt === undefined ||
      (typeof session.expiresAt === "string" && Number.isFinite(Date.parse(session.expiresAt))))
  );
}

// Classification only: never replay a reset automatically or persist its draft.
export function classifyKovaRecoveryResetResponse(status, payload) {
  // Shape confirmation controls this page's UX only; it is not Auth authority.
  if (status >= 200 && status < 300 && hasPublicPrincipalShape(payload)) {
    return { confirmed: true, preserveDraft: false, message: "" };
  }
  if (status === 429) {
    return {
      confirmed: false,
      preserveDraft: true,
      message:
        "Too many attempts. Wait before retrying with the same reset link. Your password draft is kept only on this page.",
    };
  }
  if (status === 408 || status >= 500 || (status >= 200 && status < 300)) {
    return {
      confirmed: false,
      preserveDraft: true,
      message: KOVA_RECOVERY_UNCONFIRMED_MESSAGE,
    };
  }
  return {
    confirmed: false,
    preserveDraft: false,
    message:
      "This reset attempt was not accepted. Check your new password and link. If the link was already used or expired, request a new one.",
  };
}
