function fail(code, cause) {
  throw new StripeCustomerMappingError(code, cause);
}
function requireResult(result, code) {
  if (result?.error || !result?.data) fail(code, result?.error);
  return result.data;
}
export class StripeCustomerMappingError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = "StripeCustomerMappingError";
    this.code = code;
  }
}

/** Email remains contact data, never authorization or immutable Customer identity. */
export async function resolveStripeCustomerId({ stripe, supabase, environment, userId, email }) {
  if (typeof userId !== "string" || !userId) fail("stripe_customer_user_missing");
  if (environment !== "sandbox" && environment !== "live")
    fail("stripe_customer_environment_invalid");
  const lookup = await supabase
    .from("stripe_customer_mappings")
    .select("stripe_customer_id")
    .eq("environment", environment)
    .eq("user_id", userId)
    .maybeSingle();
  if (lookup?.error) fail("stripe_customer_mapping_lookup_failed", lookup.error);
  if (lookup?.data?.stripe_customer_id) return lookup.data.stripe_customer_id;

  // This reservation survives ambiguous Stripe errors and blocks account deletion.
  // Its identity cannot be replaced merely because Stripe's 24-hour cache elapsed.
  const request = requireResult(
    await supabase.rpc("claim_stripe_customer_creation", {
      _user_id: userId,
      _environment: environment,
    }),
    "stripe_customer_creation_claim_failed",
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      request.requestId ?? "",
    )
  )
    fail("stripe_customer_creation_invalid");
  const requestedAt = Date.parse(request.requestedAt);
  if (!Number.isFinite(requestedAt)) fail("stripe_customer_creation_invalid");
  const prior = await stripe.customers.search({
    query: `metadata['kovaCustomerCreation']:'${request.requestId}'`,
    limit: 2,
  });
  if (!Array.isArray(prior?.data) || prior.has_more || prior.data.length > 1) {
    fail("stripe_customer_creation_reconciliation_ambiguous");
  }
  let customer = prior.data[0];
  if (!customer) {
    if (Date.now() - requestedAt >= 23 * 60 * 60 * 1000) {
      fail("stripe_customer_creation_reconciliation_pending");
    }
    customer = await stripe.customers.create(
      {
        ...(email ? { email } : {}),
        metadata: { userId, environment, kovaCustomerCreation: request.requestId },
      },
      { idempotencyKey: `kova-customer-${environment}-${request.requestId}` },
    );
  }
  if (
    !/^cus_[A-Za-z0-9]+$/u.test(customer?.id ?? "") ||
    customer.deleted === true ||
    customer.metadata?.userId !== userId ||
    customer.metadata?.environment !== environment ||
    customer.metadata?.kovaCustomerCreation !== request.requestId
  ) {
    fail("stripe_customer_creation_identity_mismatch");
  }
  const mapped = requireResult(
    await supabase.rpc("complete_stripe_customer_creation", {
      _user_id: userId,
      _environment: environment,
      _request_id: request.requestId,
      _customer_id: customer.id,
    }),
    "stripe_customer_mapping_insert_failed",
  );
  if (mapped !== customer.id) fail("stripe_customer_mapping_insert_mismatch");
  return mapped;
}
