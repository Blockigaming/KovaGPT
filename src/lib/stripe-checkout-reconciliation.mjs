export class StripeCheckoutPendingError extends Error {
  constructor() {
    super("stripe_checkout_reconciliation_pending");
    this.name = "StripeCheckoutPendingError";
  }
}

/** Never rotate an ambiguous POST key, even after an empty authoritative list. */
export async function resolveDurableCheckoutSession({
  stripe,
  supabase,
  userId,
  environment,
  attempt,
  params,
}) {
  const key = attempt.idempotencyKey;
  const mark = async (outcome, sessionId = null) => {
    const result = await supabase.rpc("mark_stripe_checkout_attempt", {
      _user_id: userId,
      _environment: environment,
      _idempotency_key: key,
      _outcome: outcome,
      _session_id: sessionId,
    });
    if (result?.error || result?.data !== true) throw new StripeCheckoutPendingError();
  };
  const accept = async (session) => {
    if (
      !session ||
      !/^cs_[A-Za-z0-9_]+$/u.test(session.id ?? "") ||
      session.customer !== params.customer ||
      session.metadata?.userId !== userId ||
      session.metadata?.kovaCheckoutAttempt !== key ||
      session.mode !== "subscription"
    ) {
      throw new StripeCheckoutPendingError();
    }
    if (session.status === "complete" || session.status === "expired") {
      await mark(session.status, session.id);
      throw new StripeCheckoutPendingError();
    }
    if (
      session.status !== "open" ||
      typeof session.client_secret !== "string" ||
      !session.client_secret ||
      !Number.isSafeInteger(session.expires_at) ||
      session.expires_at <= Date.now() / 1000
    ) {
      throw new StripeCheckoutPendingError();
    }
    await mark("ready", session.id);
    return session;
  };
  if (attempt.outcome !== "new") {
    let found = null;
    for await (const session of stripe.checkout.sessions.list({
      customer: params.customer,
      limit: 100,
    })) {
      if (session.metadata?.kovaCheckoutAttempt !== key) continue;
      if (found) throw new StripeCheckoutPendingError();
      found = session;
    }
    if (found) {
      // List projections need not contain the embedded secret.
      return accept(await stripe.checkout.sessions.retrieve(found.id));
    }
    if (attempt.outcome !== "pending") throw new StripeCheckoutPendingError();
  }
  // An old unknown request may still acquire side effects during reconciliation.
  // Its exhausted idempotency window must never generate another POST.
  if (Date.parse(attempt.sessionExpiresAt) <= Date.now()) throw new StripeCheckoutPendingError();
  await mark("pending");
  try {
    return await accept(
      await stripe.checkout.sessions.create(params, {
        idempotencyKey: `kova-checkout-${environment}-${userId}-${key}`,
      }),
    );
  } catch (error) {
    if (error instanceof StripeCheckoutPendingError) throw error;
    // Leave the durable attempt pending, including cached 500/network failures.
    throw new StripeCheckoutPendingError();
  }
}
