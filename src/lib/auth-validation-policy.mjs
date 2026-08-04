const TERMINAL_USER_ERROR_CODES = new Set([
  "bad_jwt",
  "session_expired",
  "session_not_found",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_banned",
  "user_not_found",
]);

const VALID_DISPOSITION = Object.freeze({
  kind: "valid",
  clearBrowserStorage: false,
  signOut: false,
  principalResolution: "authenticated",
});

const RETRYABLE_DISPOSITION = Object.freeze({
  kind: "retryable",
  clearBrowserStorage: false,
  signOut: false,
  principalResolution: "unresolved",
});

const TERMINAL_DISPOSITION = Object.freeze({
  kind: "terminal",
  clearBrowserStorage: true,
  signOut: true,
  principalResolution: "guest",
});

function stringField(error, field) {
  if (!error || typeof error !== "object") return null;
  const value = error[field];
  return typeof value === "string" ? value : null;
}

function numericStatus(error) {
  if (!error || typeof error !== "object") return null;
  const value = error.status;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Destructive cleanup requires affirmative terminal identity evidence.
 * Unknown, fetch, rate-limit, timeout, and server failures fail closed as
 * retryable so an auth outage can never erase offline principal data.
 */
export function isTerminalUserValidationError(error) {
  const code = stringField(error, "code");
  if (code && TERMINAL_USER_ERROR_CODES.has(code)) return true;

  const status = numericStatus(error);
  return status === 401 || status === 403;
}

export function classifyAuthValidationResult({
  userError = null,
  assuranceError = null,
  userPresent = true,
  userIdMatches = true,
  userDeleted = false,
  userBanned = false,
} = {}) {
  if (userDeleted || userBanned || !userIdMatches || (!userPresent && !userError)) {
    return TERMINAL_DISPOSITION;
  }
  if (userError) {
    return isTerminalUserValidationError(userError) ? TERMINAL_DISPOSITION : RETRYABLE_DISPOSITION;
  }
  // Assurance lookup failure alone is not evidence that the user or session
  // is invalid. Keep the principal unresolved and retry without cleanup.
  if (assuranceError) return RETRYABLE_DISPOSITION;
  return VALID_DISPOSITION;
}

/** Arbitrary thrown validation errors are transport/runtime failures, not proof of sign-out. */
export function classifyThrownAuthValidationError(_error) {
  return RETRYABLE_DISPOSITION;
}

/** Session restoration returns structured auth errors too. Unlike arbitrary
 * thrown transport failures, explicit 401/403 and terminal token/session codes
 * prove the persisted session cannot be retained indefinitely. */
export function classifySessionRestoreError(error) {
  return isTerminalUserValidationError(error) ? TERMINAL_DISPOSITION : RETRYABLE_DISPOSITION;
}

/** A restore or queued auth event may commit only while its captured token is
 * still the latest validation and the provider effect remains mounted. */
export function isCurrentAuthValidation(capturedValidation, currentValidation, cancelled = false) {
  return !cancelled && capturedValidation === currentValidation;
}

/**
 * A retry may keep an already validated same-user principal available offline.
 * Initial and account-switch failures stay unresolved rather than falling back
 * to guest or exposing the previous account.
 */
export function retryableAuthPrincipalState(candidateUserId, validatedUserId) {
  if (
    typeof candidateUserId === "string" &&
    candidateUserId.length > 0 &&
    candidateUserId === validatedUserId
  ) {
    return { principalResolution: "authenticated", userId: validatedUserId };
  }
  return { principalResolution: "unresolved", userId: null };
}
