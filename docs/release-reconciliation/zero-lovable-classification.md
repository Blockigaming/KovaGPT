# Zero-Lovable classification and removal gate

## Final rule

Production may not contain a Lovable package, credential, hosted runtime, email or webhook dependency, build dependency, outbound request, or credit requirement.

## Retained compatibility URLs

The six historical `/lovable/email/*` URLs are inert HTTP 410 tombstones. They perform no work, read no credentials, send no data, and never return a success state. They exist only to make stale callers fail explicitly during migration.

The historical `/.lovable/oauth/consent` URL is a compatibility redirect to `/oauth/consent`. The real Supabase OAuth consent UI and approve/deny operations live at `/oauth/consent`. After the Supabase authorization path is updated and external clients have aged out, remove the redirect.

## Removed active artifacts

- `.lovable/` project, plan, and MCP metadata
- `@lovable.dev/email-js`
- `@lovable.dev/webhooks-js`
- unsupported Bun lock/configuration that contained stale hosted-package locations
- Lovable AI gateway selection, keys, endpoints, email sending, and webhook verification

## Executable gates

- `npm run release:zero-lovable` checks active source, package declarations, compatibility-route shape, installed packages, and generated browser/server output. It reports stale npm lock metadata as a warning.
- `npm run release:zero-lovable:strict` additionally rejects stale Lovable entries in the npm lockfile. This is mandatory for the final candidate.
- `npm run security:ai-runtime` separately rejects provider secrets and managed-gateway paths.

## Remaining lockfile action

`package-lock.json` must be regenerated with the repository's pinned npm/Node environment after the package declarations change. Do not hand-edit it. Final strict validation and `npm ci` must run against the regenerated lockfile before merge.

## Runtime proof still required

Source and build scans do not prove production network behavior. The final Azure candidate must be inspected for environment variables, browser/server bundles, CSP, logs, OAuth/email/webhook paths, and outbound requests. Browser and server observations must show no request to a Lovable domain.
