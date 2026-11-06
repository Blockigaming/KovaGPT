# Voice and billing activation for PR #580

The web changes remain in PR #580; the live Stripe portal configuration was corrected separately on November 6, 2026 as recorded below. The web app already proxies recordings and saved-reply speech to ElevenLabs using `ELEVENLABS_API_KEY` on the server. The new Responses → Voice check reads the signed-in account's safe configuration status. It never accepts, returns or stores an API key in the browser.

## ElevenLabs

Use the existing restricted ElevenLabs key stored in Azure Key Vault, with the minimum STT/TTS permissions and a provider credit cap. Keep the key out of chat, source, client variables and command arguments. Choose a voice that the account can access. Preserve the voice feature flag, verified-account checks, daily cap, model allowlist and signing secret.

The existing app can be inspected and configured with `scripts/azure/configure-elevenlabs.mjs`. It defaults to a review and accepts the resource group, an accessible voice ID and an existing versioned Key Vault secret URI. It uses only an existing managed identity, preserves the current cap, refuses an incomplete model-signing policy and never changes ingress, replicas, unrelated secrets or AI activation gates. Add `--apply` only when approving the reviewed production revision change.

Run `node scripts/voice/check-elevenlabs.mjs` inside the private app environment to report non-secret readiness. Then verify a real signed-in microphone recording, transcription, saved assistant reply, ElevenLabs playback and Stop. Configuration status and mocked tests are not live provider acceptance.

The completed Azure inspection on November 6 confirmed the existing versioned Key Vault reference, `ELEVENLABS_API_KEY`, the voice/speech activation flags, the model-proof secret binding and `KOVA_VOICE_OPENAI_MODELS_JSON`. The first environment-table view was virtualized and omitted later rows; those entries are present. The existing daily request cap remains 10. No key value was copied into source or the browser.

A read-only request from the production container to ElevenLabs `/v1/voices` returned HTTP 200 and 22 provider voices. A signed-in saved chat displayed Ready to talk with Lily available. A subsequent signed-in Read aloud test on a saved reply progressed from Loading audio to Reading aloud; pressing Stop returned the control to idle. This verifies the application's playback-start and Stop states for that reply, without claiming an auditory-quality check. Dictation reported that no microphone was found in the cloud browser, so real recording, transcription and a complete microphone-driven conversation remain unverified. The existing signed model policy was preserved.

## Billing

Stripe inspection and the authorized configuration correction on November 6, 2026 confirmed:

- `plus_monthly`: live active USD 16/month, `price_1UAzhHAEZlsb6DBYWw2oUCeO`.
- `pro_monthly`: live active USD 80/month, `price_1UEw6FAEZlsb6DBYuksCKOBR`.
- The authorized live coupon `kova_first_month_50` is valid, 50% off, duration `once`, with metadata identifying `monthly-intro-v1`. It was created and separately retrieved. The application controls new-subscription eligibility. For eligible monthly individual subscriptions, Plus is USD 8 for the first month then USD 16/month, and Pro is USD 40 for the first month then USD 80/month, before tax. No purchase was completed.
- Default portal `bpc_1UB2ZxAEZlsb6DBYU3PoJJPU` previously permitted only quantity changes. It now permits price changes restricted to the two existing Plus/Pro prices above, with quantity adjustment disabled. Its business-profile Terms and Privacy links now point to `/terms` and `/privacy`. A separate expanded GET verified the saved configuration. Cancellation at period end, proration, trial behavior, invoice history and payment-method/customer update settings were preserved. No customer subscription, charge, price amount or tax setting was changed.
- The current enabled webhook points to the live Kova payment webhook and includes subscription and invoice lifecycle events. Its event list does not include asynchronous checkout success or risk/refund events. Review the handlers before changing event subscriptions; do not subscribe to events without a defined processing policy.

The app now takes Upgrade directly to `/pricing`, keeps plan selection at `/subscribe`, and offers Stripe-hosted review for existing subscriptions instead of sending people to Settings. The server resolves the authenticated account's own customer and subscription, validates the fixed target Price and product, and creates a portal confirmation flow; it does not directly change a subscription or charge a card. A missing explicit portal configuration can use Stripe's active account default; a malformed explicit configuration still fails.

`scripts/azure/configure-billing-portal.mjs` reviews the existing live Prices and portal. With an explicit `--apply`, it enables selection of only those existing Plus/Pro Prices and fills in the existing public Terms/Privacy URLs. It does not create products, change prices, cancel subscriptions, perform a purchase or change tax settings. Use the existing restricted server credential in the secure operator environment, never a shell argument or source file.

The existing monthly-intro lifecycle and guarded billing-catalog migrations were applied after their prerequisite checks. The guarded catalog registered the two current live prices and retained the legacy USD 89 Pro price for recognition of existing subscriptions. A service-role read of `kova_policy_readiness()` returned `ready: true`, `schemaVersion: monthly-intro-v1` and `recoveryHours: 720`. No customer subscription or entitlement was changed.

Production configuration activation created healthy revision `kovagpt-prod-web--billingintro-1106a` and routed 100% of traffic to it. It added `KOVA_BILLING_POLICY_VERSION=monthly-intro-v1` and `STRIPE_MONTHLY_INTRO_COUPON_ID=kova_first_month_50`, preserving the existing immutable image `sha256:0cec7f60dab24e70ca31d4e40d3f8fa9c890f4e6e886cb1893d2edcdbf0b83c1`, unrelated environment entries, secret bindings and rollback revision `kovagpt-prod-web--models-80b5754`. This configuration change does not deploy PR #580's web changes.

Authenticated Checkout now passes the rollout gate but still fails at the coupon lookup. A read-only provider probe from the production container using the actual application credential returned HTTP 200 for prices, customers, subscriptions and checkout-session reads, but HTTP 403 `more_permissions_required` for `GET /v1/coupons/kova_first_month_50`. The owner is updating the existing restricted key in Stripe: Live mode → Developers/API keys → Restricted keys → the application key → Edit key → Coupons: Read → Save. Preserve all other permissions; do not rotate or reveal the key. If the application key is unclear, identify its failed coupon request in View request logs.

After that permission is saved, retry both plans through the authenticated application's normal Checkout path, verify first-month discount and renewal amounts, and verify durable lifecycle/webhook handling. A successful Stripe configuration inspection is not a passed Checkout test. Preserve the readiness and database-contract guards. Tax collection requires the appropriate registration; no automatic-tax or registration change is included.

## Integration follow-up

The three stale Settings/composer integration contracts were updated without removing fixed-price validation, safe-area ownership or attachment-menu placement coverage. Their 23 focused checks, changed-file formatting and ESLint pass. The production Cloudflare build and zero-Lovable build audit pass. With the generated Worker and office artifacts present, the full integration run passes 567 of 568 checks; the remaining Worker boot check cannot start Wrangler because this executor rejects `os.networkInterfaces()` (`uv_interface_addresses`, system error 1). Do not weaken the check or alter network restrictions to hide that limitation. Full GitHub CI is required to verify the Worker runtime on its normal runner.
