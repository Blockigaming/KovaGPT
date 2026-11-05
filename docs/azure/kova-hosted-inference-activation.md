# Kova hosted inference — production activation runbook (NOT YET EXECUTED)

## Selected architecture

KovaGPT retains its existing Azure Container App and always-warm API gateway.
Only text inference is routed to already-running, usage-metered provider GPUs.
There is **no dedicated Kova GPU server to purchase**.

- **Kova Argon 4.6** -> `deepseek/deepseek-v4-flash-0731`
- **Kova Neon 4.6** -> `meta-llama/llama-4-maverick`
- **Kova Xenon 5** -> `moonshotai/kimi-k3`

The aliases are Kova product identities; the underlying foundation models are supplied by DeepSeek, Meta and Moonshot AI. Inference traffic is handled by OpenRouter and its selected providers. These are candidate mappings, not independently proven parity with OpenAI's fast/balanced/frontier lineup.
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
KOVA_MODEL_DEFAULT_CHAT=kova-argon-4.6
KOVA_MODEL_ADVANCED_REASONING=kova-neon-4.6
KOVA_MODEL_PREMIUM_REASONING=kova-xenon-5
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
3. Verify Kimi K3 and Llama 4 Maverick multimodal inputs using bounded inline images. The original DeepSeek V4 Flash is text-only: it must reject image inputs, not silently substitute a different base model. External image URLs must be rejected. Image generation and cloud-browser services remain independently available through their existing routes.
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
- Browser idle: both Playwright and Work browser staging code use a 15-minute
  renewable inactivity lease and no absolute session age cap. The coordinated
  PostgreSQL migration, runner image and web app deployment are **not live**.
- Browser activity must describe observed operations; a progress animation is not
  evidence that a website actually opened.

## Status on 2026-11-05

Adapter code, Kova model aliases, identity and accounting hooks: PR branch only.
Cloud account/API key, Azure secrets, staging deployment, upstream compatibility,
typecheck/CI, customer consent and live production cutover: NOT VERIFIED.

## Tier quality acceptance

Argon is speed-first (4096 tokens); Neon is balanced reasoning (8192 tokens); Xenon is max reasoning (16384 tokens). Their server-owned OpenRouter routing caps prices per 1M input/output tokens at Argon $0.20/$0.80, Neon $0.50/$1.50, Xenon $3.00/$15.00 and prioritizes low latency. These are price ceilings, not the cheapest advertised rates. Only launch after assessing real token usage, median/p95 first-token latency, tool calling, vision accuracy, and same-model failover, including hidden reasoning-token accounting.

### Model selection lock

Owner-selected foundations are fixed: Xenon = Kimi K3 (`moonshotai/kimi-k3`), Neon = Llama 4 Maverick (`meta-llama/llama-4-maverick`), Argon = DeepSeek V4 Flash (`deepseek/deepseek-v4-flash-0731`, the pinned GA July 2026 snapshot). Never substitute Qwen3.5 Flash, DeepSeek V4.1 Flash or other models without the owner's explicit request. The original Argon model is text-only; any image-analysis tool must be a separately authorized capability, not a covert switch of the chosen base model. Test all model IDs and provider capabilities before enabling paid inference.
