# Cloudflare edge security contract

`src/server.ts` is authoritative for response hardening. The release check requires CSP, HSTS, nosniff, referrer, permissions, clickjacking, CSRF-origin, and 16 MiB request-body controls. `wrangler.jsonc` disables source-map upload.

The CSP permits only integrations already used by the product: Clerk scripts/frames/connectivity (`*.clerk.com`, `*.clerk.accounts.dev`), Stripe scripts/frames/API (`js.stripe.com`, `hooks.stripe.com`, `api.stripe.com`), Supabase HTTPS/WebSocket connectivity (`*.supabase.co`), and Google font styles/files. Images allow HTTPS because generated/provider image URLs are external. No wildcard script source is allowed.

Run `npm run release:edge` for the local source contract. A deployed probe requires both `KOVA_EDGE_BASE_URL=https://…` and an exact hostname in `KOVA_EDGE_ALLOWED_HOSTS`; it checks safe GET response headers only. Production probing is never implicit.
