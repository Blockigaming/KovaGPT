# Production-readiness audit

Audited 2026-07-27 across public routes, authenticated workspaces, server functions, uploads, connectors, local recovery state, and production build output.

## Resolved in this checkpoint

- Library query failures now surface as recoverable errors instead of appearing as a false empty Library.
- One-time Prompt, App, and Context Pack payloads use session storage, with legacy local-storage reads retained only for safe migration.
- Family Center PINs are no longer stored as plaintext; new and changed PINs use salted PBKDF2-SHA-256 with 120,000 iterations. Existing plaintext values remain verifiable only to allow replacement or removal.
- Apps exposes only genuinely supported Google integrations. The unreachable timer-based simulated connector success path and misleading catalog description were removed.
- Remote Library images require an allowlisted HTTPS host, bounded redirects, a safe raster MIME type, an 8 MB maximum, and matching binary file signatures.
- Prompt Studio preserves unsaved creation drafts, clears them after a successful save, exposes retry recovery, and retains entered work after network errors.
- Knowledge Graph exposes retry and guided empty-state actions; expensive graph edge and position calculations are memoized.
- Project suggestions and Help submissions now have bounded request timeouts with specific recovery messages.
- The global offline banner no longer promises automatic retries that every feature cannot guarantee.
- Stale implementation TODOs were resolved or converted into the intentional items below.

## Intentional deferred engineering

- **Inline attachment cleanup:** chat attachments currently live inside message records, not object storage. Object cleanup becomes necessary only if uploads move to a bucket.
- **Durable long-chat summary activation:** source now includes bounded owner-scoped summary jobs, verified history-prefix reuse, lease/revision fences, privacy deletion, and a retryable internal worker. `KOVA_CHAT_SUMMARIES_ENABLED` remains false until the owner applies its migration, configures a dedicated worker secret/schedule, verifies provider budget and privacy evidence, and monitors completed/retrying/superseded batch counts. No live activation has occurred.
- **Per-request model classification:** current explicit modes and capability routing remain deterministic. A classifier requires evaluation data and provider budget controls.
- **Cross-device local workspace state:** Work drafts, some preferences, and branch metadata require an owner-scoped sync schema and conflict resolution.
- **Atomic multi-row bulk operations:** current operations recover by refreshing authoritative state; true atomicity requires database RPCs.
- **Realtime collaboration:** presence and concurrent editing require realtime subscriptions and revision conflict resolution.

## Launch gates outside this repository

- Apply all Supabase migrations and verify RLS policies in the production project.
- Configure supported provider credentials and Google OAuth redirect origins.
- Verify Stripe products and webhook delivery in live mode.
- Configure the scheduler/worker before representing scheduled execution as generally available.
- Run browser-driven responsive, accessibility, and visual regression suites with installed Playwright browsers.
- Establish production monitoring, alert routing, backups, restore drills, and rate-limit dashboards.

## Known build advisory

The production build succeeds, but two client chunks remain above Vite's 500 kB advisory. Route-level splitting is present; further reduction requires profiling the core chat/router/vendor graph rather than speculative manual chunking before launch.

## Known quality baseline

The repository-wide lint command still reports 1,071 legacy formatting errors and 31 warnings across untouched files. Every TypeScript file changed in this checkpoint has zero ESLint errors (two existing Fast Refresh co-export warnings remain). Clearing the global baseline should be a dedicated mechanical formatting change so production hardening remains reviewable and behavior changes are not obscured.
