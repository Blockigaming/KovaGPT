# Production edge security contract

Cloudflare provides the public DNS/proxy/security edge; Azure Container Apps provides the application runtime. Azure ingress must allow only Cloudflare's current published CIDRs after cutover. There is no Worker, Pages, Wrangler, or Cloudflare-hosted application deployment.

`src/server.ts` remains authoritative for application response hardening: CSP, HSTS, nosniff, referrer policy, permissions policy, clickjacking protection, CSRF/origin checks, bounded request bodies, safe CORS, and no sensitive caching. `npm run release:edge` verifies the application contract. `npm run cloudflare:edge:verify` verifies the live Cloudflare/Azure boundary and writes sanitized evidence.

See `docs/day16/cloudflare-edge-only.md` for the complete final configuration.
