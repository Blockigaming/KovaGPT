# DNS, certificate, and callback cutover

## Pre-cutover (read only)

1. Export the intended public origin, Azure host, Supabase callback, Google/GitHub callbacks, Stripe webhook, and exact allowed hosts to sanitized JSON.
2. Run `node scripts/staging-validation/domain-callbacks.mjs --input <callbacks.json>`; it rejects HTTP, localhost, Lovable preview hosts, and wildcard allowlists.
3. Record current DNS A/AAAA/CNAME/TXT values and TTL, Azure custom-domain binding, managed-certificate state, root/`www` canonical policy, and provider callback registrations.
4. **STOP** unless the certificate is valid for the exact hostname and every callback path exactly matches the repository route.

## Authorized mutation and verification

Lower TTL only under the approved change ticket, add the Azure domain-verification record, bind the custom domain/certificate, then update the intended DNS record. Verify TLS chain/hostname, HTTP-to-HTTPS redirect, root/`www` canonical behavior, `/api/health`, OAuth callbacks, Supabase callback, and Stripe webhook reachability before increasing traffic.

## Rollback

Restore the recorded DNS values and Azure traffic to the known-good revision. Keep certificate and verification records until recovery is confirmed. Revert provider callbacks only after traffic/DNS recovery. DNS rollback does not undo data written during the cutover.
