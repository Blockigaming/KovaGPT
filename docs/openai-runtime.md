# KovaGPT direct OpenAI runtime

> **Current zero-Lovable status:** PR #227 is merged and its former compatibility routes are absent from source, route metadata, and locally built artifacts. The direct Azure OpenAI/OpenAI runtime is current. Production control-plane and deployed-network proof remains tracked separately in issue #208; see `docs/release-reconciliation/zero-lovable-classification.md`.

## Active request flow and inventory

The only active text-generation flow is browser chat -> `POST /api/chat` -> bounded validation -> trusted-IP/authentication -> server billing entitlement -> catalog routing -> conservative token/cost preflight -> atomic Supabase reservation/concurrency lease -> `provider.server.ts` -> OpenAI `POST /v1/responses` -> server Responses-to-Kova SSE adapter -> existing streaming UI -> atomic usage reconciliation. Stop or disconnect cancels the provider reader and finalizes the lease. No browser module receives a provider credential, model override, provider URL, or output limit.

| Cost path                       | Caller                    | Server receiver                      | Direct provider              | Policy/accounting                                    |
| ------------------------------- | ------------------------- | ------------------------------------ | ---------------------------- | ---------------------------------------------------- |
| Main and project chat           | `index.tsx`, project chat | `/api/chat`                          | OpenAI Responses             | guest/user quotas, leases, idempotency, actual usage |
| Google tool follow-ups          | `/api/chat` loop          | `/api/chat`                          | OpenAI Responses             | same reserved request; 8 hops/16 calls               |
| Titles                          | chat client               | `/api/title`                         | OpenAI Responses             | utility model, bounded title ingress/rate limit      |
| Memory extraction/compaction    | memory client             | `/api/memory`                        | OpenAI Responses             | utility model, consent/auth/input bounds             |
| Writing and project suggestions | workspace clients         | `/api/write`, `/api/project-suggest` | OpenAI Responses             | verified user, quota, bounded ingress                |
| Deep research synthesis         | chat                      | `/api/chat` + research module        | Firecrawl + OpenAI Responses | paid entitlement before provider                     |
| Images                          | chat/images UI            | `/api/chat`, `/api/generate-image`   | OpenAI Images                | verified user, daily image quota                     |
| Project RAG                     | project ingestion/query   | `project-rag.server.ts`              | OpenAI Embeddings            | authenticated project boundary                       |

Search itself uses Firecrawl, not an AI fallback. No scheduled/model moderation/audio generation route was found. The former Lovable-named compatibility surfaces were removed by merged PR #227. Lovable AI is neither active nor a fallback.

## Versioned model catalog

`src/lib/ai/model-catalog.server.ts` is the only text model/pricing catalog. Version `2026-08-03` was reviewed against the official [OpenAI model catalog](https://platform.openai.com/docs/models) and [OpenAI API pricing](https://platform.openai.com/docs/pricing). Automated tests verify that routing code contains no scattered model ID. Deployment owners must additionally confirm project permission through `GET /v1/models` because model access is project-specific; an unsupported configured ID fails closed and is never silently substituted.

| Policy   | Default        | Allowed plan        | Max Kova output | Purpose                                        |
| -------- | -------------- | ------------------- | --------------: | ---------------------------------------------- |
| Instant  | `gpt-4.1-nano` | guest/free/Plus/Pro |             600 | cheapest basic chat                            |
| Normal   | `gpt-4.1-mini` | free/Plus/Pro       |           1,500 | efficient general chat                         |
| Thinking | `gpt-5-mini`   | Plus/Pro            |           3,000 | paid reasoning; shared premium allowance       |
| Deep     | `gpt-5`        | Pro                 |           4,000 | strongest approved bounded reasoning           |
| Utility  | `gpt-4.1-nano` | server tasks        |             500 | titles, extraction, classification, compaction |

Images default to `gpt-image-1`; embeddings default to `text-embedding-3-small`. Both are official server-side endpoint models and remain independently configurable.

## Budget and quota enforcement

All critical settings are parsed once through a strict Zod schema in `config.server.ts`. Missing, non-positive, nonnumeric, or excessive values fail closed rather than falling back after a typo.

| Variable                           |     Default | Enforcement                                                                |
| ---------------------------------- | ----------: | -------------------------------------------------------------------------- |
| `KOVA_MAX_COST_USD_PER_REQUEST`    |    USD 0.10 | catalog price x conservative full input/output reservation before provider |
| `KOVA_MAX_TOKENS_PER_USER_DAY`     |      50,000 | atomic `acquire_ai_generation`, UTC day                                    |
| `KOVA_MAX_TOKENS_PER_USER_MONTH`   |     500,000 | same transaction, UTC month                                                |
| `KOVA_MAX_PREMIUM_REQUESTS_PERIOD` |          50 | Thinking+Deep combined, authoritative subscription period                  |
| `KOVA_MAX_GUEST_REQUESTS_PER_IP`   |       5/day | Cloudflare-observed normalized IP, HMAC-SHA256 stored, never raw IP        |
| `KOVA_MAX_CONCURRENT_GLOBAL`       |          10 | PostgreSQL advisory-lock acquisition + expiring active leases              |
| `KOVA_MAX_CONCURRENT_PER_USER`     |           2 | same transaction, authenticated principal                                  |
| `KOVA_MAX_CONCURRENT_PER_GUEST`    |           1 | same transaction, guest IP hash                                            |
| `KOVA_GENERATION_LEASE_SECONDS`    | 120 seconds | stale nonterminal cleanup during acquisition                               |

The reservation is input estimate plus maximum authorized output. The conservative estimator includes UTF-8, JSON structure, system instructions, tools and image allowances. Whole-message trimming keeps the active system policy and newest turn. Provider usage reconciles input/cached/output/reasoning and actual catalog cost. Provider rejection/failure releases reserved budget by terminal reconciliation; accepted premium requests, including user-aborted work that may have incurred provider cost, count toward the shared premium allowance. A missing terminal provider event fails the stream and retains conservative accounting rather than inventing zero cost. Finalization is conditional on a nonterminal state, so it is exactly once.

The trusted guest boundary is `CF-Connecting-IP` in Cloudflare production. Arbitrary `X-Forwarded-For` is ignored. Non-Cloudflare deployments must install an equivalent trusted proxy adapter rather than trusting public forwarding headers.

## Usage inspection

The additive `ai_usage_events` table contains identifiers, plan/mode/model, reservation and provider token categories, catalog costs, tool counts, state, latency, error classification, and timestamps. It intentionally has no prompt or response column. RLS permits an authenticated user to select only their own rows; browser roles cannot insert/update/delete. Service role owns acquisition/finalization RPC execution.

Configured administrators can query bounded, paginated aggregate data at `GET /api/admin/ai-usage`. It reports today/month requests, token classes, cost by model/mode/plan, internal high-usage user IDs, status/error totals, average/p95 latency and stale reservations. It never returns conversation content.

## Completed automated verification

- TypeScript, ESLint, unit, API, production build, bundle secret scan and browser-runtime tests.
- PGlite executes the exact migration and verifies RLS/grants plus acquire/duplicate/finalize behavior.
- A deterministic local HTTP mock emits Responses text, function arguments, malformed/unknown events, usage, abrupt termination and cancellation through the production SSE compatibility adapter.
- Desktop and mobile Playwright tests mock only the network provider result and verify one submission, idempotency header, SSE rendering, durable conversation storage, kill-switch presentation, no retry, one sidebar logo and no horizontal overflow.

## Launch checklist

### Completed in this repository

1. Direct Responses API adapter, catalog, config schema, token/cost preflight, distributed quota/lease RPCs, reconciliation and sanitized errors are implemented.
2. Migration syntax/state/RLS behavior is executed against temporary PostgreSQL-compatible PGlite.
3. Mocked provider and desktop/mobile browser tests run without OpenAI or Lovable credits.
4. Source and generated client/server bundles, maps and assets are secret-scanned.

### Owner: private OpenAI project (never paste a key into chat, GitHub, PR text, or logs)

1. Create a dedicated OpenAI production project in the OpenAI dashboard.
2. Configure project spend limits and alerts.
3. Allow only the catalog models/endpoints required above.
4. On a private administrative machine, create a restricted project API key and place it directly in the deployment provider's encrypted `OPENAI_API_KEY` secret field.
5. With the key available only in the shell environment, verify project model access without printing the key: `curl -fsS https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | jq -e '.data | length > 0' >/dev/null`.

### Owner: deployed Supabase

1. Back up the database and apply migrations through the normal release pipeline.
2. Confirm `ai_usage_events.relrowsecurity`, authenticated SELECT-only grant, service-role RPC grants, and both idempotency indexes.
3. Call acquisition/finalization from a private staging worker and confirm the admin aggregate endpoint.

### Owner: deployment provider

1. Set every server-only variable from `.env.example`, including a new random 32+ byte `KOVA_IP_HASH_SECRET`; keep `AI_GENERATION_ENABLED=false`.
2. Deploy the built Worker and run health/database checks.
3. Run the deterministic mock smoke and `npm run security:ai-runtime` against downloaded deployed assets.
4. Perform exactly one manually authorized live instant request from staging. Verify streamed text and Stop, then compare OpenAI project usage with its single `ai_usage_events` row.
5. Set `AI_GENERATION_ENABLED=true`, redeploy, monitor provider errors/cost/stale leases, and increase limits only from measured usage.

## Rotation, disablement, and rollback

Rotate by creating a second restricted project key, replacing the encrypted server secret, deploying, making one verified request, then revoking the old key. Never print either key.

For an incident, set `AI_GENERATION_ENABLED=false` and redeploy. Existing conversations, auth, billing and settings remain readable; new chat, utility, image and embedding provider calls fail closed before provider fetch.

Rollback application code to the prior tested direct-OpenAI release while leaving generation disabled. Do not reactivate Lovable AI. The additive usage table may safely remain. Re-enable only after migration checks, mock tests, one owner-authorized live request and deployed-bundle scanning pass.
