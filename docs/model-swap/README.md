# Prepared text-provider swap

This source change prepares an explicit text-provider switch. Publishing or merging it does not activate generation or deploy a new Azure revision.

KOVA_TEXT_PROVIDER=openai selects direct OpenAI text even when Azure endpoint variables remain. azure_openai selects Azure text and requires an Azure endpoint. Missing credentials, invalid selections or missing explicit Azure endpoints fail closed; no cross-provider fallback. Unset/auto preserves existing endpoint-based selection. Images and embeddings retain endpoint-based routing and existing shared readiness checks.

The existing configured role mapping remains: Cosmo = gpt-5.6-luna, Orion = gpt-5.6-terra, Nova = gpt-5.6-sol. These are configured provider IDs, not verified account access or proprietary trained weights. No Qwen model or training job was modified. Existing entitlements, metering, per-request limits and the cumulative Models budget remain unchanged.

The two example overlays contain no key and leave both generation flags disabled. Reuse the already-installed server key through the existing secret-management path. Never commit it, put it in a browser variable or copy it into an artifact. Keep GitHub as the source delivery route and the existing Cloudflare/Azure hosting architecture; no ChatGPT Sites registration is needed.

Before cutover: run required repository CI on the selected release commit; stage the OpenAI selection and existing secret through the normal server configuration path; confirm account model access, budget headroom and live-test authority; complete the separately bounded smoke test. Then enable generation only in the authorized deployment. Preserve all existing IP-hash, auth, database and budget settings. This preparation does not establish those deployment prerequisites.

Activation requires an environment refresh/restart or revision rollout. It is a configuration switch, not a guaranteed zero-downtime instantaneous transition. Runtime generation config is cached; do not edit a local file and assume active processes changed. Allow in-flight requests to finish or stop them under the existing deployment procedure.

Rollback: disable generation first, restore the previous environment/revision and provider selection, retain the previous Azure endpoint/deployment aliases and secret references, then re-enable only if authorized and verified. Do not automatically retry an uncertain provider call. Keep image generation and embeddings outside this text cutover.

Source publication does not grant additional provider or cloud spending authority. Verify the approved cumulative budget and available headroom before any live call. Local mocked checks create no provider charge. Live model access, provider latency, streamed browser chat and hosted persistence are not verified by these checks.

Startup validation checks credentials for the explicitly selected text provider. OpenAI selection does not require unused Azure text deployment aliases. Any retained Azure endpoint is still validated because image/embedding routes can use it; malformed retained Azure endpoints must be corrected rather than bypassed. Unknown selections are rejected without echoing values.
