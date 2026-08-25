# Cloudflare edge-only production contract

Cloudflare is not an application runtime. There is no Wrangler deployment, Worker entrypoint, Pages deployment, or Cloudflare-hosted KovaGPT server.

The final edge configuration requires:

- active `kovagpt.com` zone;
- one proxied CNAME for `kovagpt.com` and one for `www.kovagpt.com`, both targeting the approved Azure origin;
- Full (strict) TLS, Always Use HTTPS, and minimum TLS 1.2;
- Azure Container App ingress restricted to Cloudflare's current published IPv4 and IPv6 CIDRs, with no temporary verification ranges remaining;
- public responses carrying `cf-ray` and the exact `x-kova-build` identity;
- CSP, HSTS, nosniff, referrer policy, permissions policy, safe CORS, and no server-identity leakage.

`npm run cloudflare:edge:plan` is non-mutating. `npm run cloudflare:edge:verify` reads Cloudflare and Azure state, compares them, and writes sanitized evidence. It contains no Cloudflare mutation method.
