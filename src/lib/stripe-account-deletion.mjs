const TERMINAL_SUBSCRIPTION_STATES = new Set(["canceled", "incomplete_expired"]);

function terminal(status) {
  return typeof status === "string" && TERMINAL_SUBSCRIPTION_STATES.has(status);
}

export async function cancelAuthoritativeStripeSubscriptions({ stripe, customerId }) {
  if (
    !stripe?.subscriptions ||
    typeof customerId !== "string" ||
    !/^cus_[A-Za-z0-9]+$/u.test(customerId)
  ) {
    throw new Error("stripe_customer_mapping_invalid");
  }

  let examined = 0;
  let canceled = 0;
  for await (const subscription of stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  })) {
    examined += 1;
    if (
      !subscription ||
      typeof subscription.id !== "string" ||
      !subscription.id ||
      typeof subscription.status !== "string"
    ) {
      throw new Error("stripe_subscription_identity_invalid");
    }
    if (terminal(subscription.status)) continue;

    try {
      const result = await stripe.subscriptions.cancel(subscription.id);
      if (!terminal(result?.status)) {
        throw new Error("stripe_subscription_cancellation_unproven");
      }
      canceled += 1;
    } catch (cancellationError) {
      let current;
      try {
        current = await stripe.subscriptions.retrieve(subscription.id);
      } catch {
        throw cancellationError;
      }
      if (!terminal(current?.status)) throw cancellationError;
    }
  }

  return { examined, canceled };
}

export async function retireStripeCustomerForAccountDeletion({ stripe, customerId }) {
  if (
    !stripe?.customers ||
    typeof customerId !== "string" ||
    !/^cus_[A-Za-z0-9]+$/u.test(customerId)
  ) {
    throw new Error("stripe_customer_mapping_invalid");
  }

  const existing = await stripe.customers.retrieve(customerId);
  if (!existing || existing.id !== customerId) {
    throw new Error("stripe_customer_identity_mismatch");
  }
  if (existing.deleted === true) {
    return { alreadyDeleted: true, examined: 0, canceled: 0 };
  }

  const cancellation = await cancelAuthoritativeStripeSubscriptions({
    stripe,
    customerId,
  });

  // This is the final concurrency barrier. Customer deletion invalidates any
  // Checkout Session that raced the subscription scan and immediately cancels
  // any subscription created during that window.
  const deleted = await stripe.customers.del(customerId);
  if (!deleted || deleted.id !== customerId || deleted.deleted !== true) {
    throw new Error("stripe_customer_deletion_unproven");
  }

  return { alreadyDeleted: false, ...cancellation };
}
