import { stripeSubscriptionBlocksCheckout } from "./stripe-subscription-status.mjs";
import { buildMonthlyIntroSessionParams } from "./billing-policy-params.ts";

export const MONTHLY_INTRO_POLICY_VERSION = "monthly-intro-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const id = (value, prefix) =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`, "u").test(value);

export class BillingPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "BillingPolicyError";
    this.code = code;
  }
}
const fail = (code) => {
  throw new BillingPolicyError(code);
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
async function rpc(supabase, name, args = {}, allowNull = false) {
  const operation = supabase.rpc(name, args);
  if (typeof operation?.abortSignal !== "function")
    fail("billing_policy_shared_state_deadline_unavailable");
  const result = await operation.abortSignal(AbortSignal.timeout(10_000));
  if (result?.error || (!allowNull && result?.data == null))
    fail("billing_policy_shared_state_unavailable");
  return result.data;
}

/** This is not a billing-mode switch: both the version and installed contract must pass. */
export async function requireMonthlyIntroReadiness(supabase) {
  const result = await rpc(supabase, "kova_policy_readiness");
  if (
    !object(result) ||
    result.schemaVersion !== MONTHLY_INTRO_POLICY_VERSION ||
    result.ready !== true ||
    result.recoveryHours !== 720
  ) {
    fail("billing_policy_contract_not_ready");
  }
}

/** Existing Prices, currency and full recurring amounts are never replaced by this policy. */
export function validateMonthlyIntroPrice(price, plan, environment) {
  if (
    !object(price) ||
    price.id !== plan.livePriceId ||
    price.lookup_key !== plan.lookupKey ||
    price.active !== true ||
    price.type !== "recurring" ||
    price.livemode !== (environment === "live") ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1 ||
    !Number.isSafeInteger(price.unit_amount) ||
    price.unit_amount <= 0
  ) {
    fail("billing_policy_monthly_price_invalid");
  }
  return price;
}

/** The operator provisions a reusable, unrestricted 50%-once Coupon separately. No mutation here. */
export function validateMonthlyIntroCoupon(coupon, couponId, environment) {
  if (
    !object(coupon) ||
    coupon.id !== couponId ||
    coupon.deleted === true ||
    coupon.valid !== true ||
    coupon.livemode !== (environment === "live") ||
    coupon.percent_off !== 50 ||
    coupon.amount_off != null ||
    coupon.duration !== "once" ||
    (coupon.applies_to?.products?.length ?? 0) !== 0 ||
    coupon.redeem_by !== null ||
    coupon.max_redemptions !== null
  ) {
    fail("billing_policy_coupon_invalid");
  }
  return coupon;
}

/** Email is contact data only. An account deletion fence is checked even for an existing mapping. */
export async function resolvePolicyCustomer({
  stripe,
  supabase,
  environment,
  userId,
  email,
  now = Date.now(),
}) {
  if (!UUID.test(userId) || !["live", "sandbox"].includes(environment))
    fail("billing_policy_identity_invalid");
  const args = { p_user: userId, p_environment: environment };
  const claim = await rpc(supabase, "kova_policy_claim_customer", args);
  if (claim.state === "mapped" && id(claim.customerId, "cus")) return claim.customerId;
  if (
    claim.state !== "pending" ||
    !UUID.test(claim.requestId ?? "") ||
    !Number.isFinite(Date.parse(claim.requestedAt))
  )
    fail("billing_policy_customer_claim_invalid");
  const prior = await stripe.customers.search({
    query: `metadata['kovaPolicyCustomer']:'${claim.requestId}'`,
    limit: 2,
  });
  if (!Array.isArray(prior?.data) || prior.has_more !== false || prior.data.length > 1)
    fail("billing_policy_customer_reconciliation_pending");
  let customer = prior.data[0];
  if (!customer) {
    // The durable claim outlives Stripe's idempotency cache. Age never authorizes a fresh identity.
    if (now - Date.parse(claim.requestedAt) >= 23 * 60 * 60 * 1000)
      fail("billing_policy_customer_reconciliation_pending");
    customer = await stripe.customers.create(
      {
        ...(email ? { email } : {}),
        metadata: { userId, environment, kovaPolicyCustomer: claim.requestId },
      },
      { idempotencyKey: `kova-policy-customer:${environment}:${claim.requestId}` },
    );
  }
  if (
    !id(customer?.id, "cus") ||
    customer.deleted === true ||
    customer.metadata?.userId !== userId ||
    customer.metadata?.environment !== environment ||
    customer.metadata?.kovaPolicyCustomer !== claim.requestId
  )
    fail("billing_policy_customer_identity_mismatch");
  const mapped = await rpc(supabase, "kova_policy_complete_customer", {
    ...args,
    p_request: claim.requestId,
    p_customer: customer.id,
  });
  if (mapped !== customer.id) fail("billing_policy_customer_identity_mismatch");
  return mapped;
}

function validateClaim(claim, { userId, environment, customerId, priceId, returnUrl }) {
  if (
    !object(claim) ||
    !UUID.test(claim.claimId ?? "") ||
    claim.idempotencyKey !== `kova-checkout:${claim.claimId}` ||
    claim.environment !== environment ||
    claim.customerId !== customerId ||
    !id(claim.customerId, "cus") ||
    claim.priceId !== priceId ||
    !id(claim.priceId, "price") ||
    claim.returnUrl !== returnUrl ||
    typeof claim.returnUrl !== "string" ||
    !Number.isFinite(Date.parse(claim.requestedAt)) ||
    !Number.isFinite(Date.parse(claim.expiresAt)) ||
    !["pending", "open", "completed", "expired"].includes(claim.state) ||
    typeof claim.introEligible !== "boolean" ||
    (claim.introEligible
      ? typeof claim.couponId !== "string" || !claim.couponId
      : claim.couponId !== null) ||
    !UUID.test(userId) ||
    !["live", "sandbox"].includes(environment)
  ) {
    fail("billing_policy_checkout_claim_invalid");
  }
  return claim;
}

const couponIdentity = (discount) => {
  const coupon = discount?.coupon ?? discount?.source?.coupon;
  return typeof coupon === "string" ? coupon : coupon?.id;
};

/** Authoritative expanded Stripe state is checked before returning a secret or settling history. */
function verifySession(session, claim, { userId, environment, customerId }) {
  const lines = session?.line_items;
  const discounts = session?.discounts ?? [];
  if (
    !id(session?.id, "cs") ||
    session.customer !== customerId ||
    session.livemode !== (environment === "live") ||
    session.mode !== "subscription" ||
    session.metadata?.userId !== userId ||
    session.metadata?.kovaPolicyClaim !== claim.claimId ||
    session.metadata?.kovaPolicyVersion !== MONTHLY_INTRO_POLICY_VERSION ||
    session.return_url !== claim.returnUrl ||
    !lines ||
    lines.has_more !== false ||
    !Array.isArray(lines.data) ||
    lines.data.length !== 1 ||
    lines.data[0]?.quantity !== 1 ||
    lines.data[0]?.price?.id !== claim.priceId ||
    !Array.isArray(discounts) ||
    (claim.couponId
      ? discounts.length !== 1 || couponIdentity(discounts[0]) !== claim.couponId
      : discounts.length !== 0)
  ) {
    fail("billing_policy_checkout_identity_mismatch");
  }
  if (
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at !== Math.floor(Date.parse(claim.expiresAt) / 1000)
  )
    fail("billing_policy_checkout_expiry_mismatch");
  return session;
}

async function retrieveVerifiedSession(options, claim, sessionId) {
  const session = await options.stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"],
  });
  return verifySession(session, claim, options);
}

async function settleVerifiedSession(options, claim, session) {
  if (session.status !== "complete" && session.status !== "expired") return;
  const outcome = session.status === "complete" ? "completed" : "expired";
  // Session completion can precede a delayed payment. Reserve eligibility conservatively;
  // never grant access here. The existing verified subscription/invoice webhook remains authority.
  await rpc(options.supabase, "kova_policy_settle_checkout", {
    p_user: options.userId,
    p_environment: options.environment,
    p_claim: claim.claimId,
    p_session: session.id,
    p_outcome: outcome,
  });
}

export async function createMonthlyIntroCheckout(options) {
  const { stripe, supabase, userId, environment, plan, couponId, returnUrl } = options;
  const now = options.now ?? Date.now();
  await requireMonthlyIntroReadiness(supabase);
  const prices = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
  });
  const price = validateMonthlyIntroPrice(prices.data?.[0], plan, environment);
  const customerId = await resolvePolicyCustomer({ ...options, now });
  const customer = await stripe.customers.retrieve(customerId, { expand: ["discount"] });
  if (
    customer?.id !== customerId ||
    customer.deleted === true ||
    customer.livemode !== (environment === "live") ||
    (customer.metadata?.userId && customer.metadata.userId !== userId)
  )
    fail("billing_policy_customer_identity_mismatch");
  // Do not remove an existing Customer discount or silently allow it to stack
  // with / outlive the once-only introduction. Existing subscriptions are unchanged.
  if (!("discount" in customer) || customer.discount !== null)
    fail("billing_policy_customer_discount_requires_review");
  for await (const subscription of stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  })) {
    if (stripeSubscriptionBlocksCheckout(subscription, Math.floor(now / 1000)))
      fail("billing_policy_active_subscription_exists");
  }
  if (typeof couponId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(couponId))
    fail("billing_policy_coupon_not_configured");
  validateMonthlyIntroCoupon(await stripe.coupons.retrieve(couponId), couponId, environment);
  const claim = validateClaim(
    await rpc(supabase, "kova_policy_claim_checkout", {
      p_user: userId,
      p_environment: environment,
      p_price: price.id,
      p_coupon: couponId,
      p_return_url: returnUrl,
    }),
    { userId, environment, customerId, priceId: price.id, returnUrl },
  );
  if (claim.couponId && claim.couponId !== couponId) fail("billing_policy_checkout_claim_invalid");
  const bound = { stripe, supabase, userId, environment, customerId };
  let session;
  if (claim.sessionId) {
    session = await retrieveVerifiedSession(bound, claim, claim.sessionId);
  } else {
    let found = null;
    for await (const candidate of stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
    })) {
      if (candidate.metadata?.kovaPolicyClaim !== claim.claimId) continue;
      if (found) fail("billing_policy_checkout_reconciliation_pending");
      found = candidate;
    }
    if (found) {
      session = await retrieveVerifiedSession(bound, claim, found.id);
    } else {
      // No new POST is permitted after its original expiry or idempotency safety bound.
      if (
        claim.state !== "pending" ||
        Date.parse(claim.expiresAt) <= now ||
        now - Date.parse(claim.requestedAt) >= 23 * 60 * 60 * 1000
      )
        fail("billing_policy_checkout_reconciliation_pending");
      const created = await stripe.checkout.sessions.create(
        buildMonthlyIntroSessionParams({
          userId,
          customerId,
          claimId: claim.claimId,
          priceId: price.id,
          couponId: claim.couponId,
          returnUrl: claim.returnUrl,
          expiresAt: Math.floor(Date.parse(claim.expiresAt) / 1000),
        }),
        { idempotencyKey: claim.idempotencyKey },
      );
      if (!id(created?.id, "cs")) fail("billing_policy_checkout_reconciliation_pending");
      session = await retrieveVerifiedSession(bound, claim, created.id);
    }
    await rpc(supabase, "kova_policy_attach_checkout", {
      p_user: userId,
      p_environment: environment,
      p_claim: claim.claimId,
      p_session: session.id,
      p_expires_at: new Date(session.expires_at * 1000).toISOString(),
    });
  }
  await settleVerifiedSession(bound, claim, session);
  if (
    session.status !== "open" ||
    session.expires_at <= now / 1000 ||
    typeof session.client_secret !== "string" ||
    !session.client_secret
  )
    fail("billing_policy_checkout_not_open");
  return session;
}

/** Called only after the existing webhook signature/environment checks. Metadata is a lookup, not proof. */
export async function reconcileMonthlyIntroCheckout({
  stripe,
  supabase,
  userId,
  environment,
  claimId,
  sessionId,
}) {
  if (!UUID.test(userId ?? "") || !UUID.test(claimId ?? "") || !id(sessionId, "cs"))
    fail("billing_policy_checkout_event_invalid");
  const claim = await rpc(supabase, "kova_policy_checkout_status", {
    p_user: userId,
    p_environment: environment,
    p_claim: claimId,
  });
  validateClaim(claim, {
    userId,
    environment,
    customerId: claim.customerId,
    priceId: claim.priceId,
    returnUrl: claim.returnUrl,
  });
  const options = { stripe, supabase, userId, environment, customerId: claim.customerId };
  const session = await retrieveVerifiedSession(options, claim, sessionId);
  await rpc(supabase, "kova_policy_attach_checkout", {
    p_user: userId,
    p_environment: environment,
    p_claim: claim.claimId,
    p_session: session.id,
    p_expires_at: new Date(session.expires_at * 1000).toISOString(),
  });
  await settleVerifiedSession(options, claim, session);
}

/** Cleanup never creates a Customer or Session, and absence from a list never releases a claim. */
export async function reconcileAccountMonthlyIntroCheckout({ stripeFactory, supabase, userId }) {
  if (!UUID.test(userId ?? "")) fail("billing_policy_identity_invalid");
  const claim = await rpc(supabase, "kova_policy_pending_checkout", { p_user: userId }, true);
  if (claim == null) return;
  validateClaim(claim, {
    userId,
    environment: claim.environment,
    customerId: claim.customerId,
    priceId: claim.priceId,
    returnUrl: claim.returnUrl,
  });
  const stripe = stripeFactory(claim.environment);
  const options = {
    stripe,
    supabase,
    userId,
    environment: claim.environment,
    customerId: claim.customerId,
  };
  let sessionId = claim.sessionId;
  if (!sessionId) {
    // One bounded page is sufficient only for a uniquely matching result. An
    // incomplete collection remains fenced for operator reconciliation.
    const page = await stripe.checkout.sessions.list({ customer: claim.customerId, limit: 100 });
    if (!Array.isArray(page?.data) || page.has_more !== false)
      fail("billing_policy_checkout_reconciliation_pending");
    const matches = page.data.filter(
      (session) => session.metadata?.kovaPolicyClaim === claim.claimId,
    );
    if (matches.length !== 1) fail("billing_policy_checkout_reconciliation_pending");
    sessionId = matches[0].id;
  }
  const session = await retrieveVerifiedSession(options, claim, sessionId);
  if (session.status !== "complete" && session.status !== "expired")
    fail("billing_policy_checkout_reconciliation_pending");
  await rpc(supabase, "kova_policy_attach_checkout", {
    p_user: userId,
    p_environment: claim.environment,
    p_claim: claim.claimId,
    p_session: session.id,
    p_expires_at: new Date(session.expires_at * 1000).toISOString(),
  });
  await settleVerifiedSession(options, claim, session);
}
