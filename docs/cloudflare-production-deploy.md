# Cloudflare production edge boundary

## Architecture

Azure Container Apps is the full KovaGPT application origin. Cloudflare may provide only owner-approved edge services in front of that origin: proxied DNS, TLS, WAF and rate limiting, and canonical redirects.

The retained `.github/workflows/deploy-cloudflare-production.yml` filename is historical. Its workflow is **validation-only**. It does not build or deploy the application, use Cloudflare credentials, create routes, change DNS, or shift traffic. In particular, it does not create or change DNS records.

## What the validation workflow proves

A manual run with the exact `VALIDATE` confirmation on `main` checks the repository's edge-only architecture contract. It proves only source configuration for the selected GitHub revision. It does not prove the live Cloudflare zone, proxy state, TLS mode, WAF, cache behavior, redirects, or origin protection.

## Live changes remain owner-required

An authorized Cloudflare operator must inventory and back up the live zone before any mutation. The operator must then verify the approved records and rules, preserve rollback values, and capture redacted post-change evidence such as record/rule identifiers, `CF-Ray`, cache behavior, canonical redirects, and denial of unauthorized raw-origin access.

No source-only workflow may claim that those live checks passed.
