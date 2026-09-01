# Cloudflare production edge boundary

## Architecture

Azure Container Apps is the full KovaGPT application origin. Cloudflare may provide only owner-approved edge services in front of that origin: proxied DNS, TLS, WAF and rate limiting, and canonical redirects.

The retained `.github/workflows/deploy-cloudflare-production.yml` filename is historical. Its workflow is **validation-only**. It does not build or deploy the application, use Cloudflare credentials, create routes, change DNS, or shift traffic. In particular, it does not create or change DNS records.

## What the validation workflow proves

A manual run with the exact `VALIDATE` confirmation on `main` checks the repository's edge-only architecture contract. It proves only source configuration for the selected GitHub revision. It does not prove the live Cloudflare zone, proxy state, TLS mode, WAF, cache behavior, redirects, or origin protection.

## Live changes remain owner-required

An authorized Cloudflare operator must inventory and back up the live zone before any mutation. For `kovagpt.com` and `www.kovagpt.com`, the operator must associate the same custom per-hostname Authenticated Origin Pull leaf certificate with both hostnames rather than using the shared global certificate or two permanent leaves. Azure ingress requires a client certificate, and the application pins the certificate's SHA-256 thumbprint from Azure's overwritten `X-Forwarded-Client-Cert` header. Reusing one leaf for both canonical hostnames preserves the second pin slot for zero-downtime rotation.

The operator must place one approved fingerprint in `cloudflareClientCertificateSha256Fingerprints`. During rotation, deploy the old and new fingerprints together, associate the new certificate in Cloudflare, verify canonical traffic and raw-origin denial, then remove the old fingerprint in a later Azure deployment. At no point should more than two fingerprints be configured.

For the first cutover, do not apply the steady-state `require` template before Cloudflare is ready to present the certificate. Rehearse the custom certificate against a non-production/canary hostname with Container Apps temporarily set to `accept`, enable and verify per-hostname AOP, then promote the same fingerprint with the production `require` deployment. Keep the previous Azure revision, ingress setting, and DNS values ready for immediate rollback. The temporary `accept` state is transition evidence only and is never a production pass.

Afterward, verify the approved records and rules, preserve rollback values, and capture redacted post-change evidence such as certificate and record/rule identifiers, `CF-Ray`, cache behavior, canonical redirects, the exact Azure-served build, and denial of unauthorized raw-origin access. Never record the private key or full certificate material in GitHub.

No source-only workflow may claim that those live checks passed.
