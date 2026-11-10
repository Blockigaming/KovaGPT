# Private GHCR registry migration

Production uses ghcr.io/blockigaming/kovagpt-web by immutable digest, with minimum 1 and maximum 4 replicas. Its read-only pull credential expires 2027-02-08 and must be rotated before expiry.

The one-time mirror workflow archives all ACR manifests and verifies raw digests, including OCI evidence artifacts. The ghcr-image-map artifact maps original references to their private GHCR copies.

Future production candidates use build-ghcr-production-candidate.yml with reviewed main source and BUILD_ONLY. It uses existing validated browser input handling, a verified Git archive, GitHub build compute, and private GHCR. It does not deploy or increase Azure spending. Legacy ACR workflows must not be used after registry retirement.

Retirement gates: completed archive with digest map, all current app/job references reconciled, stopped nonproduction apps kept stopped, build workflow CI accepted, current GHCR revision healthy at 100%, and an independently usable rollback from archived images. Do not delete ACR until these pass and irreversible deletion is approved.

Rollback before retirement: activate models627-4c0a75c, wait healthy, route 100%, deactivate ghcr-20261110. After retirement: copy a saved revision template with its archived GHCR digest and existing registry credentials; preserve all other settings, then health-check before routing traffic.
