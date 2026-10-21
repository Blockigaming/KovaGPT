# ElevenLabs configuration handoff

Approved interface candidate: `3d7ea795b32ee21d5bc85569a1d44d4826e57508` (owner approval October 17, 2026). This optional configuration-source delta does not deploy or activate it. Preserve the candidate's exact UI and the separately owned Auth, Models and Terminal changes.

## Copy-ready request to Terminal

Read your current candidate Git SHA/tree and existing nonsecret resource inventory. Return the verified Container App, resource group, Key Vault, managed identity and test-candidate availability; do not read or return secret values. Reconcile the approved UI/voice source and this small configuration delta onto your legitimate newer descendant, preserving your existing candidate contract and unrelated Auth/Models changes. Compile/validate the resulting Bicep locally/offline and report exact revision, changed files and failures. This request does not authorize a hosted job, Azure what-if, deployment, resource mutation, secret creation/binding, database flag change, provider call or spending. Ask for the exact missing activation authority before those actions. Do not run a command containing guessed resource placeholders.

## What is implemented

The same Node application serves `/api/voice` through `src/routes/api/voice.ts`; there is no new voice server or resource. Source-only production binding adds optional parameters to `infra/azure/production/main.bicep` and its example. All defaults keep voice unavailable. The key is referenced by versioned Key Vault URI and existing managed identity, never embedded as a raw parameter/environment value. No role assignment, resource creation, secret creation, ingress, replica, traffic or database change is introduced.

The current local review intentionally blocks external provider requests and returns unavailable voice capabilities. Its port4189/4191 runtime cannot be used as live-provider verification by entering a key. Keep that isolation intact.

## Exact destination boundary

The checked-out source does not identify a verified live Container App or vault name. They are inventoried inputs: protected `KOVA_PRODUCTION_CONTAINER_APP_NAME`, `KOVA_PRODUCTION_RESOURCE_GROUP`, and `KOVA_PRODUCTION_BICEP_PARAMETERS_JSON` (`containerAppName`, `keyVaultName`, `keyVaultResourceGroupName`, `managedIdentityName`). See `docs/azure/PRODUCTION_DEPLOYMENT_PLAN.md` and `.github/workflows/validate-azure-production.yml`.

Terminal must reconcile this small patch onto its actual current descendant and preserve its candidate contract, rather than deploy this recovery branch or replace the entire live environment list. The historical source-handoff baseline `3ec1d239e4e026a9d4d6c4d5cd232cf026648ff2` is not proof of Terminal's current head. Request Terminal's exact current head and verified resource inventory; no resource names are inferred here.

The production template deliberately has zero replicas, no ingress and no scale rules during migration. Adding voice settings does not lift that freeze. If no separately authorized running test candidate exists, runtime activation requires the existing release/deployment authorization, not a hidden local workaround.

## Smallest owner/Terminal setup

1. Owner chooses an existing accessible ElevenLabs voice ID and a positive per-user UTC-day request cap. Confirm eligible account scope and provider account credits/spending ceiling. A request cap is not a currency cap.
2. Terminal identifies the exact authorized existing vault/app/identity and current source revision. Owner enters the existing API key directly into that trusted Azure secret interface; never send the key in chat, GitHub plaintext, source, browser variables or this file. Persistent credential binding requires specific approval.
3. After approval, bind its versioned URI as `elevenLabsApiKeySecretUri`; set either legacy `elevenLabsVoiceId` or owner-reviewed `voiceCatalog` with optional `voiceDefaultId`, plus `voiceDailyRequestLimit` and explicit `voiceEnabled`/`voiceAudioEnabled`. Preserve every other environment/secret entry and existing least-privilege controls. Existing database `feature_flags` must explicitly enable `voice` through the authorized account/configuration path; missing flag fails closed. Do not run a new migration for this feature.
4. Use an authorized authenticated candidate with the exact integrated build, normal email/account restrictions and atomic `daily_usage.voice` quota. Verify capabilities before any billable POST. Keep safe error output and rollback settings recorded without secret values.

## Bounded live acceptance proposal (requires separate approval)

Use one authorized test account and an existing provider voice, with no cloned voice or third-party personal content. First GET capabilities (no audio/text provider request). Then at most one TTS request of <=120 characters of synthetic test text and one STT request of <=5 seconds of synthetic/nonpersonal audio. If voice conversion acceptance is requested, add at most one STS request of the same <=5-second synthetic audio. No automatic retries. Stop immediately on failure or unexpected capability/account identity. This transmits the selected text/audio to ElevenLabs and can consume paid credits. Obtain the actual account's tariff/credits and an explicit monetary ceiling before submitting; no exact price is asserted here. Microphone permission is separate and should be requested only for an owner-authorized physical-device check.

Verify returned MIME/duration, actual transcription, playback, cancellation, quota and account-switch behavior. Existing offline fixtures prove code boundaries, not provider success, real microphone codecs, Safari/iOS playback or deployment readiness. The UI reviews transcription before normal chat Send and explicitly reads the latest completed reply; it is not continuous voice conversation.

## Local validation

Focused source/template tests only. Azure CLI/Bicep compiler is unavailable in this workspace, so Bicep compilation/what-if is unrun. Do not claim source-pattern tests certify an Azure deployment. Existing app build and UI evidence at the approved candidate remain unchanged by this configuration-only patch.

## Account-specific voice catalog

Optional `voiceCatalog` maps to server-only `KOVA_VOICE_CATALOG`. Each owner-supplied entry contains opaque `id`, public `label`, existing `providerVoiceId`, explicit `allowedPlans` from Free/Plus/Pro, and optional `showWhenLocked`. `voiceDefaultId` maps to `KOVA_VOICE_DEFAULT_ID`. Both default empty and their environment entries are omitted, preserving legacy single-voice configuration. No actual voice-plan mapping is preconfigured. See the exact validation and API contract in `elevenlabs-integration.md`.

The server uses the existing effective billing-tier resolver on every voice request and authorizes catalog selections before charging quota. Public capability responses expose only catalog IDs, labels and eligibility; no provider IDs or secrets. Plan-specific reasoning continues through the existing chat entitlement/model route. This configuration change does not alter any model, Auth/Terminal resource contract, production ingress, replica freeze, or deployment authorization.

Optional catalog-entry `modelId` supports exactly `eleven_flash_v2_5`,
`eleven_multilingual_v2`, or `eleven_v4`. Existing entries and legacy single-voice
configuration default to Multilingual v2; Flash must be selected explicitly in
server configuration. Unsupported values fail closed. The existing `voiceCatalog`
Bicep parameter passes this field without another secret or resource. No real
voice/model tier mapping or higher-cost automatic upgrade is configured by this
change. Confirm model/account availability and audition the selected voice before
activation; mocked transport coverage does not establish acoustic quality.
