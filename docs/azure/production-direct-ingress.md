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

For the existing production app only, the already bound managed custom domain may
replace that FQDN as the single public authority by additionally setting:

```text
KOVA_AZURE_CUSTOM_PUBLIC_ORIGIN=https://kovagpt.com
```

This optional setting accepts only that exact string and only with
`CONTAINER_APP_NAME=kovagpt-prod-web`. The Azure app FQDN remains required and
must pass the same validation before the custom origin can be selected. Missing
custom configuration preserves the FQDN behavior. Empty values, `www`, HTTP,
ports, paths, credentials, case variants and any other domain fail closed; there
is no hostname list or request-selected fallback. When configured, requests to
the old Azure FQDN are rejected, including mutations whose Origin is that FQDN.
Before setting it, independently verify that this exact existing Azure app has
an active managed certificate and SNI binding for `kovagpt.com`, and that DNS
points to that app's managed ingress. The parser validates configuration syntax;
it does not discover or certify domain ownership, DNS or certificate state.

Before activation, verify the existing managed HTTP ingress is external,
`allowInsecure` is false, the target port is 3000, and there are no additional raw
TCP port mappings. Internal readiness/liveness probes should use the existing
production template's TCP checks. The public health route has the same origin
boundary as every other route; an internal HTTP probe without the managed ingress
headers is intentionally rejected.

The selected canonical origin is the only accepted authority. Without the optional
custom setting it is the app FQDN; with that setting it is `https://kovagpt.com`.
Revision, label and unselected app FQDNs are deliberately rejected. With the old revision receiving all
canonical-host traffic, complete HTTP acceptance of the candidate cannot happen
before any traffic shift. TCP readiness establishes that the candidate starts
and listens; it does not establish working Auth, providers or live data paths.

Create the candidate initially at zero traffic and verify its configuration,
immutable image/source provenance and TCP readiness. Then use a controlled
canonical-authority traffic promotion and run real authenticated HTTP acceptance.
Retain the old revision for immediate traffic rollback if acceptance fails.

Azure terminates public TLS and overwrites `X-Forwarded-Proto`. Direct mode accepts
only `https` plus the configured request authority. It rejects conflicting Host
or forwarded-host values. After verification, the server restores the public
HTTPS URL so same-origin API and Auth checks compare the real public origin.
Request bodies, authentication/signature headers and cancellation are preserved.
For POST, PUT, PATCH and DELETE requests, any supplied Origin must equal the
selected exact canonical origin, including when a browser reports `same-site`.
Originless provider callbacks continue to their existing signature checks.

Azure appends the observed client IP to `X-Forwarded-For`. Direct mode uses only
that rightmost entry for anonymous quota identity and ignores client-supplied
Cloudflare IP headers. Malformed or oversized forwarding data shares the
conservative unknown-client bucket. Other modes retain their existing behavior.

Use this same selected canonical HTTPS origin for server Auth public/auth origins
and the protected browser Auth origin. Email dispatch uses the same parser: its
explicit custom-origin setting and both Auth origins must agree with the app's
selected canonical origin. Its existing enablement and request-signature gates
remain required; configuring a custom origin does not enable dispatch. JWT/session verification, CSRF checks, Argon2id,
account-recovery duration, RLS, provider quotas and webhook signature/receipt
validation remain in place.

The migration-frozen Bicep template is unchanged. This runtime mode is for the
separately approved existing-app activation. Build/provenance qualification,
immutable image selection, traffic preservation and live acceptance are still
required. Source tests do not establish production API success.

Microsoft documents HTTPS ingress and the overwritten/appended headers in
[Ingress in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/ingress?tabs=bash),
and the shared ingress settings in
[Configure ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-how-to).
