# Kova Sites lifecycle

Sites is an owner-scoped static file workspace. New Sites and saved versions are private. Creating and downloading versions works independently of hosting. Preview and publication stay unavailable until the separate asset service is configured and answers its own health contract.

Files are stored as immutable database snapshots: at most 64 files, 2 MiB per file, 8 MiB per version, 20 retained versions and 20 active Sites per account. Each version requires `index.html`; supported assets include HTML, CSS, JavaScript, JSON/text, images, and fonts. The server recomputes the sorted manifest and each file's SHA-256. Saving a version and charging the owner's existing storage budget are one transaction. A mutation ID cannot be reused with different content.

A publication selects one exact version. Private access requires the owner or an explicitly granted existing verified account. Public publication requires a separate explicit action. Renaming keeps earlier URL names as redirects, scoped to the same Site host. Unpublishing or deleting immediately removes publication authority. Retiring a non-published version or deleting a Site queues bounded database cleanup; each version releases its original charge exactly once. Subsequent mutations advance pending cleanup, and a service-only maintenance endpoint can continue cleanup when no user is active. Auth deletion cascades all owner files; cleanup obligations survive independently.

The Sites interface supports file upload, an HTML editor, verified owner Work HTML import, version download, private/public publishing, viewer grants, revocation, and version retirement. Work import reads the current owner's actual Storage content through that owner's RLS-scoped client and checks its recorded SHA-256. It does not fabricate an output or run an agent.

## Isolated hosting

The asset process is `sites-server/index.mjs`; it does not mount the KovaGPT application, its authentication UI, or its API routes. Its separate container definition is `sites-server/Dockerfile`. Every Site uses `https://<site-uuid>.<asset-root>/<url-name>/`. The configured asset domain must be outside the application's cookie domain. No generated HTML is rendered on the application origin.

Runtime configuration requires all of these explicit values:

- `KOVA_SITES_HOSTING_ENABLED=true`
- `KOVA_SITES_ISOLATION_APPROVED=true`
- `KOVA_SITES_APP_ORIGIN=https://<application-origin>`
- `KOVA_SITES_ASSET_ORIGIN=https://<separate-asset-root>`
- `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` in the asset container

The application uses the same approved origin settings. It probes `<asset-root>/health` with a bounded request and requires `{ "ok": true, "service": "kova-sites-assets" }` before offering publication or preview. The health result is cached for 30 seconds. A configured but unavailable host cannot produce a publication success through the application route.

Private access starts in the authenticated application with a one-use 60-second ticket. The ticket travels only in the isolated landing page's URL fragment, which is removed before redemption. The asset server issues a Secure, HttpOnly, SameSite=Strict `__Host-` cookie, bound to that Site and publication epoch. Both tickets and 15-minute asset sessions bind the verified issuing Auth `session_id`. Each file read checks current ownership/grants, account deletion and bans, Auth session existence, expiry, version state, and publication epoch. Logout or session revocation therefore blocks fresh private reads. Invalid private cookies never reveal previews; the current public version remains independently readable without private authority.

Response controls include no-store caching, no-referrer, nosniff, host isolation, no application CORS grants, disabled workers/frames/objects, and a CSP that allows only the Site's own scripts/assets and data images/fonts. The runtime cannot execute generated server code, make provider calls for it, or grant application credentials to it.

The internal `POST /api/internal/site-maintenance` endpoint requires `SITES_MAINTENANCE_SECRET`, accepts no body or caller-selected scope, and cleans at most five retired versions plus bounded expired access/receipt records. No deployment, DNS, origin, secret, or scheduler has been activated by this source package.

## Work publication verification

A Site output reference is `{ kind: "site", siteId, versionId, publicationId, manifestSha256 }`. The service-only `verify_kova_site_publication(p_owner, p_site, p_version, p_publication, p_manifest_sha256)` RPC checks the exact current publication and ready immutable manifest under a current verified owner. A URL alone is not output evidence. Unpublication, deletion, or a replacement publication invalidates an older receipt.

Before live activation, deploy the dedicated asset process on the approved separate root and wildcard hosts, apply the reviewed repository migration, configure TLS and the explicit runtime values, and run authenticated two-account browser acceptance for private publication, logout/revocation, rename, public republish, and deletion. The application container must never serve on the asset hosts. These are deployment/owner actions; source, isolated role tests, and asset-handler tests do not claim that live hosting exists.

Supabase's documented session check is described in [User sessions](https://supabase.com/docs/guides/auth/sessions).
