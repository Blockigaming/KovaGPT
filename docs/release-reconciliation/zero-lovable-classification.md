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
- `npm run release:zero-lovable:production -- https://kovagpt.com <exact-40-character-sha>` is a read-only, fail-closed public collector. It requires `/api/version` and `X-Kova-Build` to match the expected SHA, requires all seven retired routes to return 404 without redirects, recursively inventories same-origin assets discovered from HTML/JavaScript, and rejects Lovable-named asset paths or readable content. Set `KOVA_ZERO_LOVABLE_EVIDENCE_FILE` to a new path to retain JSON evidence; the collector will not overwrite an existing file.

## Remaining external-caller and control-plane evidence

Repository search proves there is no source caller, redirect, proxy, package, environment declaration, generated route, email/webhook handler, or deployable artifact that requires the retired URLs. Closing #208 still requires read-only exports from systems outside this repository. Record each export's capture time, scope, stable resource identifier (never a secret), query/window, and result:

| System                        | Read-only evidence required                                                                                                                                          | Passing result                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Azure Container Apps          | Active production revision/image digest, configured environment-variable **names**, ingress rules, and sanitized request/application logs covering a declared window | Deployed revision binds to the same exact SHA; no Lovable names, URLs, credentials, routes, or requests |
| Cloudflare                    | DNS/origin and route/redirect/Worker configuration plus sanitized request/security logs for the same window                                                          | No Worker, redirect, cache rule, origin, or request preserves a retired path or Lovable host            |
| Supabase                      | Auth redirect/site URL configuration, Edge Function inventory, secret **names**, webhook/hook configuration, and sanitized function/auth logs                        | No callback, function, hook, secret name, or request calls a retired route or Lovable host              |
| OAuth/email/webhook providers | Registered callback/webhook endpoints and recent sanitized delivery/call logs                                                                                        | All legitimate callers use Kova-owned routes; no delivery targets a retired route                       |
| Public production             | JSON from the exact-SHA collector above plus an authenticated browser HAR reviewed for host/path names                                                               | Exact SHA; retired routes are 404; no Lovable-named asset, request, redirect, or response content       |

Do not infer “no external caller” from repository search alone. A provider/control-plane inventory with an explicit observation window is required. Redact values and user data; retain names, stable IDs, timestamps, status codes, target hosts/paths, and hashes needed to reproduce the conclusion.

## Production proof boundary

This repository establishes zero active Lovable dependency in source and locally built artifacts. It does not by itself prove the state of the currently deployed revision or external control planes. Issue #208 remains the production-evidence tracker until the public collector passes on the exact deployed SHA, an authenticated HAR is clean, and the external inventories above prove there is no legitimate caller. Those checks are read-only unless separately authorized; this source-only change does not perform or claim a deployment.
