# Azure production provenance audit

The `Audit Azure production provenance` workflow captures a sanitized, read-only snapshot of the positively identified production Azure Container App and its revisions.

It exists to close the evidence gap between a validated production deployment plan and the Azure revision that is actually serving traffic. It does not deploy, update, restart, scale, or shift traffic.

## Safety boundary

The workflow:

- runs only by manual dispatch from `main` when `confirmation` is exactly `AUDIT`;
- uses the protected `production` GitHub environment and its existing Azure OIDC identity;
- requires the operator to enter the already-identified resource group and Container App name rather than inferring a production target;
- optionally requires the running image to match a supplied immutable ACR digest;
- calls only `az containerapp show` and `az containerapp revision list` for Container App state;
- never reads runtime environment variables or secret values;
- uploads only sanitized app/revision/source provenance evidence.

The validator fails when the observed application image is not digest-pinned, serving traffic does not total 100%, traffic reaches a revision on a different image, or the reported latest revision is not serving.

A green audit proves only the bounded Azure image/revision/traffic facts captured by that run. It does not prove the image was built from an approved release SHA unless the image has separately passed the immutable ACR source-provenance gate, and it does not prove application health, Cloudflare routing, database migration readiness, rollback execution, or zero Lovable runtime traffic.

Do not dispatch this workflow with guessed resource names. First positively identify the production Azure account, subscription, resource group, and Container App using the owner-approved control-plane inventory process.
