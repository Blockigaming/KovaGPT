# Single discount policy

KovaGPT must allow an authorized operator to select, replace, or remove the discount for a specific subscription. A subscription item may have at most one discount. A Checkout Session for a subscription can carry at most one coupon. Customer-level discounts must not be silently added to or stacked with a subscription discount.

Checkout must verify that the requested coupon is valid, live, and compatible with the plan and the operator's billing policy. The exact selected coupon is recorded in the durable checkout claim and verified against Stripe's expanded session before any entitlement is settled. Replacing or removing a discount after a Checkout Session is created requires expiring and reconciling that unpaid session first. Do not update an active subscription or its invoices implicitly.

Discount policy validation should be generic enough to support approved coupon terms such as percent-off or amount-off, once, repeating, or forever, while keeping identity, environment, currency, redemption, plan applicability, and maximum-one-discount checks explicit. A 100% coupon may produce a zero-total invoice and does not require collecting a card when Stripe permits the subscription to be created without a payment method.
