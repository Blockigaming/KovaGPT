# Read-only direct Azure production release preflight

The manual `preflight-direct-azure-production.yml` workflow checks whether the
existing production Container App is ready for a separately reviewed direct
Azure image release. It has no build, deploy, traffic-write, secret-read or
role-assignment command. It never calls Cloudflare. A green result is a
point-in-time prerequisite, **not** a production release or proof that Auth,
Resend, OpenAI or ElevenLabs generation works.

Select current `main` and provide:

- `confirmation=PREFLIGHT_DIRECT_AZURE` and `source_sha` equal to that selected
  workflow commit;
- `expected_current_sha` from the live rollback revision's `/api/version`;
- `expected_current_image` as the exact immutable production ACR digest of that
  rollback revision, established by a previous read-only provenance audit;
- `direct_origin` as the exact `https://kovagpt-prod-web.<environment>.eastus.azurecontainerapps.io`
  origin. The live app's ingress FQDN must match it.

The protected `production` environment uses the existing OIDC identity. The
script checks its actual subscription and tenant, effective
`Microsoft.App/containerApps/write` permission at the exact existing app
resource, live external HTTPS ingress on port 3000, direct-origin runtime
settings, Key Vault backed OpenAI and ElevenLabs references, Running and
Healthy rollback revision with the reviewed digest, 100% traffic to that
revision, both public build endpoints, and unchanged app metadata on a second
read. The only output is a sanitized receipt with check booleans and a stable
failure code. No environment values, secret URIs or Azure error response are
printed or uploaded.

`Multiple` revision mode is required because a known-good active rollback
revision must remain available for a controlled traffic return. If the app is
still in `Single` mode, or the old image/traffic is unqualified, the workflow
returns `BLOCKED`. This source does not change the mode or create a revision.
The current migration Bicep template describes disabled ingress and single
revision mode; only the live ARM read can establish its present state.

To run the source test without Azure credentials:

```bash
node --test tests/unit/production-direct-deploy-preflight.test.mjs
```

The workflow intentionally does not accept a candidate image. Once a combined
candidate is built and verified at its own source SHA, a separate reviewed
release mechanism must prove candidate provenance, preserve live app config,
manage a controlled traffic change and test an actual rollback. This preflight
does not approve or perform any of those steps.
