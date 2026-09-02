const POSTGRES_UNIQUE_VIOLATION = "23505";

function fail(code, cause) {
  throw new StripeCustomerMappingError(code, cause);
}

function requireResult(result, code, { requireData = false } = {}) {
  if (result?.error) fail(code, result.error);
  if (requireData && !result?.data) fail(`${code}_no_rows`);
  return result?.data ?? null;
}

export class StripeCustomerMappingError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = "StripeCustomerMappingError";
    this.code = code;
  }
}

async function lookupMapping(supabase, environment, userId) {
  const result = await supabase
    .from("stripe_customer_mappings")
    .select("stripe_customer_id")
    .eq("environment", environment)
    .eq("user_id", userId)
    .maybeSingle();
  return requireResult(result, "stripe_customer_mapping_lookup_failed");
}

/**
 * Resolve the immutable Kova account -> Stripe Customer link. Email is used
 * only as contact data when a new Customer is created; it is never identity.
 */
export async function resolveStripeCustomerId({ stripe, supabase, environment, userId, email }) {
  if (typeof userId !== "string" || !userId) fail("stripe_customer_user_missing");
  if (environment !== "sandbox" && environment !== "live") {
    fail("stripe_customer_environment_invalid");
  }

  const existing = await lookupMapping(supabase, environment, userId);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe.customers.create(
    {
      ...(email ? { email } : {}),
      metadata: { userId, environment },
    },
    { idempotencyKey: `kova-customer-${environment}-${userId}` },
  );
  if (!customer?.id) fail("stripe_customer_create_failed");

  const inserted = await supabase
    .from("stripe_customer_mappings")
    .insert({
      environment,
      stripe_customer_id: customer.id,
      user_id: userId,
    })
    .select("stripe_customer_id")
    .maybeSingle();

  if (inserted?.error?.code === POSTGRES_UNIQUE_VIOLATION) {
    const winner = await lookupMapping(supabase, environment, userId);
    if (!winner?.stripe_customer_id) fail("stripe_customer_mapping_race_unresolved");
    return winner.stripe_customer_id;
  }

  const mapping = requireResult(inserted, "stripe_customer_mapping_insert_failed", {
    requireData: true,
  });
  if (mapping.stripe_customer_id !== customer.id) {
    fail("stripe_customer_mapping_insert_mismatch");
  }
  return customer.id;
}
