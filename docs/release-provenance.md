# Release provenance and caching

Production builds receive `KOVA_BUILD_SHA` and `KOVA_BUILD_TIME` from the protected deploy job.
`GET /api/version` exposes only that non-secret identity and the public package version, uses
`Cache-Control: no-store`, and mirrors the SHA in `X-Kova-Build`. The post-deploy smoke script
compares it with the exact workflow SHA before a release is considered verified.

Cloudflare must not cache HTML, route manifests, `robots.txt`, `sitemap.xml`, or `/api/version`.
Hashed Vite JS/CSS assets may be cached as `public, max-age=31536000, immutable`. Deployments are
atomic Worker artifact replacements: HTML and its hashed assets come from the same artifact. Purge
HTML at deploy time if a CDN cache rule is added; never purge immutable hashed assets. KovaGPT does
not register a service worker, so no application cache can retain deleted chunks.

Google Cloud must authorize the project's Supabase Auth callback URL in production (the
callback shown in Supabase Auth provider settings), not the application callback directly. Supabase
Site URL remains `https://kovagpt.com`; only Supabase's additional redirect allowlist should include
`https://kovagpt.com/~oauth/callback`. Preview and local environments use their own origin plus the
same application callback path in Supabase's redirect allowlist.
