# KovaGPT OpenAI-backed models — activation and verification

This is the current **model-only** release contract. It replaces the obsolete
November 5 OpenRouter candidate mapping. Do **not** configure OpenRouter,
provision Kova GPUs, or switch image, embedding, search, browser, connections
or scheduled-task services for this model release. The implementation landed
in merged PR #627.

## Exact model foundations

| Kova consumer model | OpenAI Responses foundation | Tiers           |
| ------------------- | --------------------------- | --------------- |
| Argon 4.6           | gpt-6-luna                  | Free, Plus, Pro |
| Neon 4.6            | gpt-6.1-terra               | Plus, Pro       |
| Xenon 5             | gpt-6.1-sol                 | Plus, Pro       |
| Argon 4.5           | gpt-5.6-luna                | Plus, Pro       |
| Neon 4.5            | gpt-5.6-terra               | Plus, Pro       |
| Xenon 4.6           | gpt-6-sol                   | Plus, Pro       |
| Xenon 6.1           | gpt-6-astra                 | Plus, Pro       |

Kova owns product identities; OpenAI develops the foundations. The seven
aliases route through Kova's fixed, server-side OpenAI Responses transport,
not a user-supplied provider URL.

- Free: Argon 4.6 Lite/Medium (2 combinations), no model picker.
- Plus: all seven models, Lite through Max (35 combinations).
- Pro: all seven models, Lite through Ultra (42 combinations).
- The six Kova processing levels are Kova-owned profiles, not necessarily
  identical to the similarly named OpenAI reasoning effort parameters.
  The exact effort and review-pass map is in src/lib/consumer-effort-policy.mjs.

## Verified source evidence (not production acceptance)

The November 8 evidence file docs/releases/2026-11-08-kova-openai-acceptance.json
reports 42 model/mode generations, seven tool round trips, 126 OpenAI provider
requests, 70 review usage receipts, and zero failures, executed in Azure Cloud
Shell through the application transport. This does **not** establish that the
running website serves the new commit or that all task quality is equivalent
to another product.

## Read-only Azure preflight

Run with authorized Azure Cloud Shell access to the **existing** production
subscription and app:

~~~sh
node scripts/azure/check-kova-model-live.mjs
~~~

The script reads configuration from rg-kovagpt-prod/kovagpt-prod-web and prints
a sanitized report. It does not fetch secret values, call a paid model,
change app settings, deploy, shift traffic or alter Azure costs.

After deploying the approved exact source image, the model route requires:

~~~dotenv
KOVA_HOSTED_INFERENCE_ENABLED=true
KOVA_MODEL_DEFAULT_CHAT=kova-argon-4.6
KOVA_MODEL_ADVANCED_REASONING=kova-neon-4.6
KOVA_MODEL_PREMIUM_REASONING=kova-xenon-5
KOVA_GENERATION_DISABLED=false
~~~

OPENAI_API_KEY must remain a protected existing Container Apps secret
reference, never plaintext in a repository, chat, frontend or logs.
Keep all account quota, cancellation, request budget, billing,
KOVA_IP_HASH_SECRET, legacy provider, image, embedding and tool settings.
KOVA_REQUEST_CAPTURE_ENABLED and KOVA_GENERATION_ACCEPTANCE_ENABLED must
not be active in ordinary production generation. The server enforces both
model role binding and the selected alias; the hosted flag alone is insufficient.

These target settings do **not** authorize a blanket environment replacement.
Do not apply the migration-frozen production Bicep to the public app. Preserve
secrets, all existing features and the previous rollback revision.

## Remaining exact-release acceptance

1. Finish exact-head CI and build a digest-pinned, production-specific image.
2. Validate protected settings on a zero-traffic candidate revision, plus
   key permissions and existing billing/usage controls without exposing values.
3. Test a signed-in Free user with only Argon Lite/Medium, Plus with seven
   models through Max, and Pro with seven models through Ultra. Reject forged
   models/efforts with server-side authorization.
4. Check streaming, tool calls, vision input, usage settlement and
   cancellation across all seven foundations. Confirm selected model
   persists correctly in saved conversations.
5. Verify the real Azure revision, image digest, public hostname,
   API version, traffic distribution and rollback health.

Do not report production success without actual authenticated acceptance.
No Azure deployment was made by this document.

## Cost and capability protections

The current runtime uses pay-per-token inference and existing account limits.
Ultra performs four same-foundation review passes and may cost more per
generation. The default request reservation ceiling is USD 2, which is not
a hard Azure spending cap. Preserve all models and capabilities; do not
silently substitute foundations or increase account spending limits.

Official model catalog: https://developers.openai.com/api/docs/models
