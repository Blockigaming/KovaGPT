# Introductory offer review boundary

This Checkpoint 1b proposal displays the owner-adopted 50% first-month offer using the canonical published prices: Plus $8 then $16/month, Pro $40 then $80/month, in USD plus applicable tax. It does not alter the plan catalog, entitlement policy, Stripe configuration, credentials, charges or backend account lifecycle.

Pricing's offer actions are disabled and their callbacks fail closed. The current server checkout remains the prior trial-era implementation. It does not supply an authoritative introductory-discount eligibility/history result or matching discount checkout. Showing the offer must never silently launch that legacy checkout. Existing verified subscription/trial status, cancellations and the Stripe portal remain visible under their existing contract. Published prices are not an invoice or a quoted next charge.

Open the ordinary private controller's “Introductory offer, controls and other drafts” link, then choose “Introductory offer”. Every identity, payment, subscription, deadline and receipt there is fictional. The local sample demonstrates:

- First use consumes the sample account's offer once.
- Cancellation, rejoining, plan changes and recovery retain the same identity and history.
- The deletion recovery window stays 30 days, with an exact sample UTC deadline.
- Passing the deadline closes sample recovery but cannot prove actual deletion.
- Only an explicit fictional completed-deletion receipt allows creation of a different sample account with fresh history.
- Existing trials/subscriptions are preserved as grandfathered samples.
- Missing account history stays unverified.

Required integration work remains unverified: durable server-owned account offer history; concurrency-safe eligibility/consumption and replay handling; first-payment discount plus normal renewal in Stripe; grandfathered term preservation; recovery retaining the same account/history; confirmed-deletion/new-identity boundaries; webhook reconciliation and payment/failure/cancellation/invoice acceptance. No part of this fixture proves those services work or authorizes them to change.
