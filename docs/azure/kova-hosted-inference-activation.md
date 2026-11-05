# Kova hosted inference — production activation runbook (NOT YET EXECUTED)

## Selected architecture

KovaGPT retains its existing Azure Container App and always-warm API gateway.
Only text inference is routed to already-running, usage-metered provider GPUs.
There is **no dedicated Kova GPU server to purchase**.

- **Kova Argon 5** -> `qwen/qwen3-8b`
- **Kova Neon 4.6** -> `qwen/qwen3-14b`
- **Kova Xenon 4.6** -> `qwen/qwen3-32b`

The aliases are Kova product identities; the base models are supplied by Qwen
and the inference traffic is handled by OpenRouter and its selected providers.
Kova must accurately disclose foundation-model provenance when asked and
respect license, data-handling, and customer-privacy requirements.

## Account and secrets (authorized operator action)

1. Establish an eligible OpenRouter account and create a **restricted, budget-limited**
   server-side API key. Check provider privacy, retention, region, price and terms.
   Do not paste it into chat, GitHub, browser code or logs.
2. Store the key in Azure Key Vault or an existing Azure Container Apps secret
   reference named for this application, never in source control.
3. Use a separate staging revision, not `kovagpt-prod-web` traffic, and verify
   `OPENROUTER_API_KEY` is only available server-side.
4. The adapter's endpoint is pinned to
   `https://openrouter.ai/api/v1/chat/completions`. Never accept URLs from
   users or model-generated tool arguments.

## Staging configuration (do not use as a production copy/paste deployment)

```dotenv
KOVA_HOSTED_INFERENCE_ENABLED=false
KOVA_MODEL_DEFAULT_CHAT=kova-argon-5
KOVA_MODEL_ADVANCED_REASONING=kova-neon-4.6
KOVA_MODEL_PREMIUM_REASONING=kova-xenon-4.6
# OPENROUTER_API_KEY is an existing secure Azure secret reference only.
```

With the flag false, Kova aliases **fail closed**. Do not activate them while
the flag is false, including in a stage preview.
Only enable `KOVA_HOSTED_INFERENCE_ENABLED=true` in an isolated staging app
after confirming credentials, allowed workloads and cost controls.

Existing OpenAI deployments remain the fallback and rollback targets. Do not
remove or overwrite their secrets. Keep image generation, embedding and web
search on their existing independently configured providers until independently
tested.

## Acceptance checks before routing real users

1. Full GitHub CI green on exact PR head, typecheck, live browser regression,
   upstream request-capture compatibility and model selection entitlement tests.
2. Streaming and non-streaming sample messages for all three aliases;
   structured tool calls, user confirmation, and authorization across accounts.
3. Verify image/document prompts never get sent to these text-only models.
   Verify image generation and cloud-browser services remain independently
   available through existing routes.
4. Verify all quota, daily spending controls, per-user concurrency, request
   cancellation, and token usage settlement; compare provider invoice samples.
5. Benchmark sustained and bursty **1 request/second aggregate** traffic,
   minimum 24 hours of hourly traffic metrics, p95 time-to-first-token,
   error rate, throughput and cost. Test provider failover before any streaming
   bytes are sent; never splice output from different models mid-stream.
6. Canary behind an account allowlist, with fast operator rollback to OpenAI.
   Preserve prior Azure revision, image digest and current secrets.
7. Re-verify the public hostname, /api/livez, /api/readyz and /api/version
   against the approved release, and check user-visible model identity.

## Gateway capacity and browser

- Keep at least one Azure CPU gateway replica warm. Configure HTTP/concurrency
  autoscaling independently from daily capacity recommendations.
- Daily planner: `node scripts/azure/kova-daily-capacity-plan.mjs hourly.json CURRENT_MAX`
  is **read-only**. It does not schedule or apply Azure changes.
- Browser idle: isolated Playwright runtime defaults to 15 minutes on PR.
  Production Work browser still has a separate 5-minute absolute authorization
  contract requiring its own coordinated migration and tests.
- Browser activity must describe observed operations; a progress animation is not
  evidence that a website actually opened.

## Status on 2026-11-05

Adapter code, Kova model aliases, identity and accounting hooks: PR branch only.
Cloud account/API key, Azure secrets, staging deployment, upstream compatibility,
typecheck/CI, customer consent and live production cutover: NOT VERIFIED.
