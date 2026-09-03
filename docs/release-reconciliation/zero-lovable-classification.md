# Zero-Lovable classification and removal gate

## Final rule

Production may not contain a Lovable package, credential, hosted runtime, route, generated chunk, email or webhook dependency, build dependency, outbound request, or credit requirement. Historical references may remain only in documentation, tests, and negative security scanners; they must not affect runtime behavior.

## Current source status

PR #227 merged as `8fed5521d0cfa7d7cb753bff22acc14c99d8a081`. The latest-main audit that started at `0cdefc4590a17ad2bd3884df9bf2477d741b131d` confirms that the seven former compatibility route modules remain absent:

- the historical OAuth redirect at `/.lovable/oauth/consent`;
- six inert email tombstones under `/lovable/email/*`.

No production source caller references those URLs. Their former route modules, shared 410 helper, generated route-tree entries, canonical-manifest records, and chunk-name inputs are removed. The only remaining references are negative regression fixtures, negative security rules, explicitly classified documentation, and immutable Git history.

## Kova-owned flows retained

- OAuth consent remains at `/oauth/consent`, including authorization-detail loading and approve/deny operations.
- Durable email suppression remains at `/email/unsubscribe`, with the signed-out `/unsubscribe` page using that endpoint.
- Auth-email sources remain repository-owned React Email templates under `src/lib/email-templates/`; the removed auth-preview URL was an inert tombstone and had no preview implementation or caller.
- Public support email remains fail-closed behind `KOVA_EMAIL_QUEUE_ENABLED` and the Kova-owned `enqueue_email` RPC.

## Inventory classification

- Package declarations and npm lock root: no Lovable dependency.
- Environment example and production runtime source: no Lovable variable or credential.
- AI, Stripe, email, and webhook providers: no Lovable runtime endpoint or caller.
- Active route source and generated route tree: absent from current `main`.
- Browser, server, and other deployable `dist/` names/content: enforced by the strict build scanner, including readable source maps when generated.
- CI workflows, Azure Bicep, Docker/container inputs, redirects/proxies, public assets, Supabase inputs, shell scripts, and release configuration: covered by the active source/control-plane scan.
- npm lockfile: every package path and metadata object is scanned, not only root dependencies.
- Tests and security scanners: retained only as negative assertions.
- Documentation: historical references retained where they explain removal evidence.

## Removed active artifacts

- `.lovable/` project, plan, and MCP metadata
- `@lovable.dev/email-js`
- `@lovable.dev/webhooks-js`
- unsupported Bun lock/configuration that contained stale hosted-package locations
- Lovable AI gateway selection, keys, endpoints, email sending, and webhook verification
- all Lovable-named compatibility routes, tombstones, redirect, route-tree entries, and chunk seeds

## Executable gates

- `npm run release:zero-lovable` rejects Lovable-named runtime and control-plane paths/content, active dependencies, prohibited project artifacts, hosted endpoints, credentials, billing metadata, any npm-lock occurrence, unclassified historical documentation, and generated artifact names/content across the complete `dist/` tree.
- `npm run release:zero-lovable:strict` additionally rejects stale Lovable entries in the npm lockfile. This is mandatory for the final candidate.
- `npm run release:zero-lovable:built` runs automatically after every `build` and `build:dev`, requires built output, and scans readable JavaScript, source-map, configuration, text, and SVG content after path-name rejection.
- `npm run security:ai-runtime` separately rejects provider secrets and managed-gateway paths.
- `tests/unit/lovable-removal.test.mjs` proves the retired files and generated manifest entries are absent while the Kova-owned OAuth, suppression, and auth-template paths remain.
- `tests/api/help-submit-security.test.mjs` proves support delivery continues through the fixed-recipient Kova queue.

## Production proof boundary

This repository establishes zero active Lovable dependency in source and locally built artifacts. It does not by itself prove the state of the currently deployed revision or external control planes. Issue #208 remains the production-evidence tracker until an authorized operator verifies the deployed SHA, confirms the retired compatibility URLs return 404, confirms no Lovable-named asset is served, and inspects Azure, Cloudflare, Supabase/provider configuration and sanitized request logs for Lovable runtime traffic. Those checks are read-only unless separately authorized; this source-only change does not perform or claim a deployment.
