# KovaGPT OpenAI-backed model activation

The November 5 OpenRouter candidate mapping is obsolete. Merged PR #627 uses seven fixed OpenAI Responses foundations, not OpenRouter or Kova-owned trained weights. Do not switch other services, model providers, images, embeddings, cloud browser, scheduled tasks, or connections as part of this release.

Argon 4.6 uses gpt-6-luna, Neon 4.6 uses gpt-6.1-terra, Xenon 5 uses gpt-6.1-sol, Argon 4.5 uses gpt-5.6-luna, Neon 4.5 uses gpt-5.6-terra, Xenon 4.6 uses gpt-6-sol, and Xenon 6.1 uses gpt-6-astra. Free has two Argon configurations; Plus has 35 model/mode combinations and Pro has 42. The customer-visible Kova effort labels are Kova-defined processing profiles, not guaranteed one-to-one OpenAI reasoning effort names.

From an authorized Azure Cloud Shell in the correct production subscription, run the read-only model check using the command below. The checker never reads secret values or modifies Azure resources.

    node scripts/azure/check-kova-model-live.mjs

The running app must have KOVA_HOSTED_INFERENCE_ENABLED set to true, KOVA_MODEL_DEFAULT_CHAT set to kova-argon-4.6, KOVA_MODEL_ADVANCED_REASONING set to kova-neon-4.6, KOVA_MODEL_PREMIUM_REASONING set to kova-xenon-5, and generation enabled. OPENAI_API_KEY must remain a protected existing secret reference. The capture and acceptance-only settings must not be active in ordinary production. Preserve all other environment variables, billing controls, secrets, image and embedding routes, the prior revision, and rollback image. Never apply the migration-frozen production Bicep template to the public app.

The November 8 Azure Cloud Shell acceptance evidence in docs/releases/2026-11-08-kova-openai-acceptance.json records 42 model/mode generations, seven tool round trips, 126 provider calls, and 70 review receipts without reported failures. This does not prove a live website rollout.

Actual production acceptance still requires an exact-commit image deployment, verification of the active revision and digest, signed-in Free/Plus/Pro requests, all seven model identities, usage accounting, cancellation, streaming, tools, and rollback health. Do not claim production success before that evidence exists. No Azure deployment was executed by this documentation.
