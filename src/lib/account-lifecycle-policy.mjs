export const ACCOUNT_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;
export const MONTHLY_POLICY_VERSION = "monthly-intro-v1";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
function fail(code) {
  throw new Error(code);
}
function principal(userId) {
  if (typeof userId !== "string" || !uuid.test(userId)) fail("account_policy_principal_invalid");
}
export async function accountPolicyRpc(admin, name, args) {
  if (typeof admin?.rpc !== "function") fail("account_policy_unavailable");
  const request = admin.rpc(name, args);
  if (typeof request?.abortSignal !== "function") fail("account_policy_timeout_unavailable");
  const result = await request.abortSignal(AbortSignal.timeout(10_000));
  if (result?.error || result?.data == null) fail("account_policy_unavailable");
  return result.data;
}

export function validateAccountPolicyState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["active", "scheduled", "finalizing"].includes(value.state)
  )
    fail("account_policy_state_invalid");
  if (value.state === "active") {
    if (value.scheduledAt != null || value.recoverUntil != null)
      fail("account_policy_state_invalid");
    return { state: "active", scheduledAt: null, recoverUntil: null };
  }
  const scheduled = Date.parse(value.scheduledAt);
  const recovery = Date.parse(value.recoverUntil);
  if (
    typeof value.scheduledAt !== "string" ||
    typeof value.recoverUntil !== "string" ||
    !Number.isFinite(scheduled) ||
    !Number.isFinite(recovery) ||
    recovery - scheduled !== ACCOUNT_RECOVERY_MS
  )
    fail("account_policy_window_invalid");
  return { state: value.state, scheduledAt: value.scheduledAt, recoverUntil: value.recoverUntil };
}

export async function readAccountPolicy(admin, userId) {
  principal(userId);
  return validateAccountPolicyState(
    await accountPolicyRpc(admin, "kova_policy_account_status", { p_user: userId }),
  );
}
export async function scheduleAccountPolicyDeletion(admin, userId) {
  principal(userId);
  const state = validateAccountPolicyState(
    await accountPolicyRpc(admin, "kova_policy_schedule_deletion", { p_user: userId }),
  );
  if (state.state === "active") fail("account_policy_schedule_unverified");
  return state;
}
export async function recoverAccountPolicy(admin, userId) {
  principal(userId);
  const state = validateAccountPolicyState(
    await accountPolicyRpc(admin, "kova_policy_recover_deletion", { p_user: userId }),
  );
  if (state.state !== "active") fail("account_policy_recovery_unverified");
  return state;
}

export async function renewAccountFinalization(admin, userId, attemptId) {
  principal(userId);
  if (!uuid.test(attemptId ?? "")) fail("account_policy_attempt_invalid");
  const lease = await accountPolicyRpc(admin, "kova_policy_renew_finalization", {
    p_user: userId,
    p_attempt: attemptId,
  });
  if (lease.attemptId !== attemptId || !Number.isFinite(Date.parse(lease.leaseUntil)))
    fail("account_policy_lease_invalid");
  return lease;
}

export async function acknowledgePolicyCustomerRetired(
  admin,
  userId,
  attemptId,
  environment,
  customerId,
) {
  principal(userId);
  if (
    !uuid.test(attemptId ?? "") ||
    !["live", "sandbox"].includes(environment) ||
    !/^cus_[A-Za-z0-9]+$/u.test(customerId ?? "")
  )
    fail("account_policy_retirement_binding_invalid");
  const result = await accountPolicyRpc(admin, "kova_policy_ack_customer_retired", {
    p_user: userId,
    p_environment: environment,
    p_customer: customerId,
    p_attempt: attemptId,
  });
  if (result !== true) fail("account_policy_retirement_unverified");
}

export async function confirmAccountFinalization(admin, userId, attemptId) {
  await renewAccountFinalization(admin, userId, attemptId);
  const result = await accountPolicyRpc(admin, "kova_policy_confirm_finalization", {
    p_user: userId,
    p_attempt: attemptId,
  });
  if (result !== true) fail("account_policy_finalization_unverified");
}

/** Validate the complete durable claim before any private cleanup or external effect. */
export function validateAccountFinalizationClaim(claim) {
  if (
    !claim ||
    typeof claim !== "object" ||
    Array.isArray(claim) ||
    claim.state !== "finalizing" ||
    typeof claim.attemptId !== "string" ||
    !uuid.test(claim.attemptId) ||
    typeof claim.leaseUntil !== "string" ||
    !Number.isFinite(Date.parse(claim.leaseUntil)) ||
    !Array.isArray(claim.customers) ||
    claim.customers.length > 2
  )
    fail("account_policy_finalization_claim_invalid");
  const environments = new Set();
  for (const mapping of claim.customers) {
    if (
      !mapping ||
      typeof mapping !== "object" ||
      Array.isArray(mapping) ||
      !["live", "sandbox"].includes(mapping.environment) ||
      environments.has(mapping.environment) ||
      typeof mapping.customerId !== "string" ||
      !/^cus_[A-Za-z0-9]+$/u.test(mapping.customerId) ||
      (mapping.retiredAt !== null &&
        (typeof mapping.retiredAt !== "string" || !Number.isFinite(Date.parse(mapping.retiredAt))))
    )
      fail("account_policy_customer_binding_invalid");
    environments.add(mapping.environment);
  }
  return claim;
}

/** Select/claim authority is in PostgreSQL, never the caller/browser clock. */
export async function runAccountPolicyFinalizerBatch({
  admin,
  reconcileCheckout,
  finalize,
  limit = 1,
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2) fail("account_policy_limit_invalid");
  const due = await accountPolicyRpc(admin, "kova_policy_due_deletions", { p_limit: limit });
  if (
    !Array.isArray(due) ||
    due.length > limit ||
    due.some((id) => typeof id !== "string" || !uuid.test(id))
  )
    fail("account_policy_due_result_invalid");
  let completed = 0;
  let pending = 0;
  for (const userId of due) {
    try {
      // Inspection/reconciliation only: this must never create another Session.
      await reconcileCheckout(userId);
      const claim = await accountPolicyRpc(admin, "kova_policy_begin_finalization", {
        p_user: userId,
      });
      validateAccountFinalizationClaim(claim);
      const result = await finalize(userId, claim);
      if (result?.status === 204) completed += 1;
      else pending += 1;
    } catch {
      // No automatic retry, forced reservation reset, or asserted completion.
      pending += 1;
    }
  }
  return { attempted: due.length, completed, pending };
}
