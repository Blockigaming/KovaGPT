# Explicit Azure direct ingress

The existing Cloudflare certificate policy remains the default. A deployment may
explicitly select direct Azure Container Apps HTTPS ingress with:

```text
AZURE_ENVIRONMENT=production
KOVA_PRODUCTION_ORIGIN_MODE=azure-direct
CONTAINER_APP_NAME=kovagpt-prod-web
KOVA_AZURE_PUBLIC_ORIGIN=https://<the-existing-app-fqdn>.azurecontainerapps.io
```

The origin must be the exact HTTPS origin returned by the existing Container App
resource. It must match the configured app name; paths, ports, credentials, query
strings, arbitrary domains and suffix lookalikes fail startup validation. Do not
change `AZURE_ENVIRONMENT` to bypass production checks or synthesize a forwarded
client certificate.

Before activation, verify the existing managed HTTP ingress is external,
`allowInsecure` is false, the target port is 3000, and there are no additional raw
TCP port mappings. Internal readiness/liveness probes should use the existing
production template's TCP checks. The public health route has the same origin
boundary as every other route; an internal HTTP probe without the managed ingress
headers is intentionally rejected.

The configured canonical app FQDN is the only accepted authority. Revision and
label FQDNs are deliberately rejected. With the old revision receiving all
canonical-host traffic, complete HTTP acceptance of the candidate cannot happen
before any traffic shift. TCP readiness establishes that the candidate starts
and listens; it does not establish working Auth, providers or live data paths.

Create the candidate initially at zero traffic and verify its configuration,
immutable image/source provenance and TCP readiness. Then use a controlled
canonical-app-FQDN traffic promotion and run real authenticated HTTP acceptance.
Retain the old revision for immediate traffic rollback if acceptance fails.

Azure terminates public TLS and overwrites `X-Forwarded-Proto`. Direct mode accepts
only `https` plus the configured request authority. It rejects conflicting Host
or forwarded-host values. After verification, the server restores the public
HTTPS URL so same-origin API and Auth checks compare the real public origin.
Request bodies, authentication/signature headers and cancellation are preserved.
For POST, PUT, PATCH and DELETE requests, any supplied Origin must equal the
configured exact app origin, including when a browser reports `same-site`.
Originless provider callbacks continue to their existing signature checks.

Azure appends the observed client IP to `X-Forwarded-For`. Direct mode uses only
that rightmost entry for anonymous quota identity and ignores client-supplied
Cloudflare IP headers. Malformed or oversized forwarding data shares the
conservative unknown-client bucket. Other modes retain their existing behavior.

Use this same exact Azure HTTPS origin for server Auth public/auth origins and
the protected browser Auth origin. Email dispatch must use its reviewed direct
Azure origin configuration. JWT/session verification, CSRF checks, Argon2id,
account-recovery duration, RLS, provider quotas and webhook signature/receipt
validation remain in place.

The migration-frozen Bicep template is unchanged. This runtime mode is for the
separately approved existing-app activation. Build/provenance qualification,
immutable image selection, traffic preservation and live acceptance are still
required. Source tests do not establish production API success.
The [direct release preflight](production-direct-deploy-preflight.md) checks
the existing app's ingress and revision state. The frozen production PLAN
cannot safely validate or apply its migration template against that live app.

Microsoft documents HTTPS ingress and the overwritten/appended headers in
[Ingress in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/ingress?tabs=bash),
and the shared ingress settings in
[Configure ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-how-to).
