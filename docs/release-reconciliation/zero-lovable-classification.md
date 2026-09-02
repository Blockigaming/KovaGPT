# Zero-Lovable classification and removal gate

## Final rule

Production may not contain a Lovable package, credential, hosted runtime, route, generated chunk, email or webhook dependency, build dependency, outbound request, or credit requirement. Historical references may remain only in documentation, tests, and negative security scanners; they must not affect runtime behavior.

## Runtime removal candidate

The repository inventory at base SHA `dc8c9c5dadee2e5e989b96c25fa1537aa84c9c3e` found seven active compatibility route modules:

- the historical OAuth redirect at `/.lovable/oauth/consent`;
- six inert email tombstones under `/lovable/email/*`.

No production source caller referenced any of those URLs. Their only repository callers were the route declarations, generated route tree, release scanner exceptions, and tests. This candidate removes all seven route modules, their shared 410 helper, generated route-tree entries, canonical-manifest records, and the resulting chunk-name inputs.

## Kova-owned flows retained

- OAuth consent remains at `/oauth/consent`, including authorization-detail loading and approve/deny operations.
- Durable email suppression remains at `/email/unsubscribe`, with the signed-out `/unsubscribe` page using that endpoint.
- Auth-email sources remain repository-owned React Email templates under `src/lib/email-templates/`; the removed auth-preview URL was an inert tombstone and had no preview implementation or caller.
- Public support email remains fail-closed behind `KOVA_EMAIL_QUEUE_ENABLED` and the Kova-owned `enqueue_email` RPC.

## Inventory classification

- Package declarations and npm lock root: no Lovable dependency.
- Environment example and production runtime source: no Lovable variable or credential.
- AI, Stripe, email, and webhook providers: no Lovable runtime endpoint or caller.
- Active route source and generated route tree: removed in this candidate.
- Browser and server bundle names/content: enforced by the strict build scanner.
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

- `npm run release:zero-lovable` rejects Lovable-named runtime source paths/content, active dependencies, prohibited project artifacts, hosted endpoints, credentials, billing metadata, and generated browser/server asset names/content. It reports stale npm lock metadata as a warning.
- `npm run release:zero-lovable:strict` additionally rejects stale Lovable entries in the npm lockfile. This is mandatory for the final candidate.
- `npm run release:zero-lovable:built` runs automatically after every `build` and `build:dev`, requires both built-output roots, and scans readable JavaScript, source-map, text, and SVG content after path-name rejection.
- `npm run security:ai-runtime` separately rejects provider secrets and managed-gateway paths.
- `tests/unit/lovable-removal.test.mjs` proves the retired files and generated manifest entries are absent while the Kova-owned OAuth, suppression, and auth-template paths remain.
- `tests/api/help-submit-security.test.mjs` proves support delivery continues through the fixed-recipient Kova queue.

## Merge and deployment blocker

Repository caller proof does not establish that legitimate external callers are absent. Azure, Cloudflare, Supabase/provider configuration, authorization paths, access/request logs, and external-client inventory were unavailable. PR #227 must remain unmerged and undeployed, and issue #208 must remain open, until an owner:

1. inventories those control planes, configurations, and logs;
2. identifies and migrates every legitimate caller of the compatibility URLs;
3. attaches pre-deploy evidence to the issue;
4. reruns exact-head hosted CI and review after the final current-main synchronization.

Closing the unmerged PR is the reversible fallback when caller migration cannot be proven. Green repository checks alone do not clear this blocker.

## Runtime proof still required

Source and build scans do not prove the public deployment changed. Only after the external-caller blocker is cleared may this exact commit be deployed. Then verify the public compatibility URLs return 404, no Lovable-named asset is served, the deployed SHA matches the reviewed SHA, and browser/server/network/log evidence contains no Lovable runtime request. Azure, Cloudflare, Supabase, and provider evidence requires operator access and is not claimed by this repository-only change.
