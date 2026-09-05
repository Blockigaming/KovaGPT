const terminal = new Set(["canceled", "incomplete_expired"]);

/** Caller must already hold the durable account-deletion fence. */
export async function prepareStripeAccountDeletion({ supabase, userId, createStripeClient }) {
  const result = await supabase.rpc("prepare_stripe_account_deletion", { _user_id: userId });
  if (result?.error || !Array.isArray(result?.data)) {
    throw new Error("stripe_account_deletion_preflight_pending");
  }
  const mappings = result.data;
  const byEnvironment = new Map();
  const prepared = [];
  for (const mapping of mappings) {
    if (
      !["live", "sandbox"].includes(mapping.environment) ||
      !/^cus_[A-Za-z0-9]+$/u.test(mapping.stripe_customer_id ?? "") ||
      byEnvironment.has(mapping.environment)
    )
      throw new Error("stripe_customer_mapping_invalid");
    byEnvironment.set(mapping.environment, mapping.stripe_customer_id);
    // Fail before any connector/storage teardown if a historical sandbox key is
    // absent. Skipping an environment would silently discard unresolved billing.
    prepared.push({
      stripe: createStripeClient(mapping.environment),
      customerId: mapping.stripe_customer_id,
    });
  }
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status, environment")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (rows?.error || !Array.isArray(rows?.data))
      throw new Error("stripe_subscription_preflight_failed");
    for (const row of rows.data) {
      if (terminal.has(row.status)) continue;
      if (byEnvironment.get(row.environment) !== row.stripe_customer_id) {
        throw new Error("stripe_subscription_customer_mismatch");
      }
    }
    if (rows.data.length < pageSize) break;
  }
  for (const item of prepared) {
    const customer = await item.stripe.customers.retrieve(item.customerId);
    if (!customer || customer.id !== item.customerId)
      throw new Error("stripe_customer_identity_mismatch");
  }
  return prepared;
}
