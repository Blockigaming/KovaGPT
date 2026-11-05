# Voice and billing activation for PR #580

No production settings are applied by this PR. The web app already proxies recordings and saved-reply speech to ElevenLabs using `ELEVENLABS_API_KEY` on the server. The new Responses → Voice check reads the signed-in account's safe configuration status. It never accepts, returns or stores an API key in the browser.

## ElevenLabs

Use the existing restricted ElevenLabs key stored in Azure Key Vault, with the minimum STT/TTS permissions and a provider credit cap. Keep the key out of chat, source, client variables and command arguments. Choose a voice that the account can access. Preserve the voice feature flag, verified-account checks, daily cap, model allowlist and signing secret.

The existing app can be inspected and configured with `scripts/azure/configure-elevenlabs.mjs`. It defaults to a review and accepts the resource group, an accessible voice ID and an existing versioned Key Vault secret URI. It uses only an existing managed identity, preserves the current cap, refuses an incomplete model-signing policy and never changes ingress, replicas, unrelated secrets or AI activation gates. Add `--apply` only when approving the reviewed production revision change.

Run `node scripts/voice/check-elevenlabs.mjs` inside the private app environment to report non-secret readiness. Then verify a real signed-in microphone recording, transcription, saved assistant reply, ElevenLabs playback and Stop. Configuration status and mocked tests are not live provider acceptance. The available browser has no signed-in Azure or ElevenLabs session, so the existing key binding has not been verified here.

## Billing

Read-only Stripe inspection on November 5, 2026 confirmed:

- `plus_monthly`: live active USD 16/month, `price_1UAzhHAEZlsb6DBYWw2oUCeO`.
- `pro_monthly`: live active USD 80/month, `price_1UEw6FAEZlsb6DBYuksCKOBR`.
- Default portal `bpc_1UB2ZxAEZlsb6DBYU3PoJJPU` has subscription updates enabled but only permits quantity changes. It does not currently offer plan-price switching. Its business-profile terms/privacy URLs are empty.
- The current enabled webhook points to the live Kova payment webhook and includes subscription and invoice lifecycle events. Its event list does not include asynchronous checkout success or risk/refund events. Review the handlers before changing event subscriptions; do not subscribe to events without a defined processing policy.

The app now takes Upgrade directly to `/pricing`, keeps plan selection at `/subscribe`, and offers Stripe-hosted review for existing subscriptions instead of sending people to Settings. The server resolves the authenticated account's own customer and subscription, validates the fixed target Price and product, and creates a portal confirmation flow; it does not directly change a subscription or charge a card. A missing explicit portal configuration can use Stripe's active account default; a malformed explicit configuration still fails.

`scripts/azure/configure-billing-portal.mjs` reviews the existing live Prices and portal. With an explicit `--apply`, it enables selection of only those existing Plus/Pro Prices and fills in the existing public Terms/Privacy URLs. It does not create products, change prices, cancel subscriptions, perform a purchase or change tax settings. Use the existing restricted server credential in the secure operator environment, never a shell argument or source file.

New Checkout remains behind the existing version/readiness and database-contract gates. Confirm `KOVA_BILLING_RETURN_ORIGIN`, Stripe publishable/server credential references, monthly policy version, database readiness, webhook signature and relevant subscription lifecycle/risk reconciliation before rollout. Do not remove a readiness guard to make a button appear to work. Tax collection requires the appropriate registration; no automatic-tax or registration change is included.
