# Live gateway activation

The November 6 product specification requires at least one running gateway replica,
a maximum of four replicas, and an HTTP scaling threshold of 20 concurrent requests.
Hosted inference and browser workers remain separate services.

`infra/azure/production/main.bicep` describes the frozen database migration target.
It is not the configuration of the existing public gateway and must not be applied
to `kovagpt-prod-web` to change its live scaling profile.

For a release of the existing gateway:

1. Read the current Container App and record its immutable image, traffic weights,
   labels, configuration and template in the operator's private release receipt.
2. Pass the observed template to `withAlwaysOnGatewayScale` from
   `scripts/azure/activate-gateway-scale.mjs`. It preserves existing containers,
   secret references, resources, probes and unrelated scale rules. It never lowers
   an existing warm minimum and rejects an unknown topology or a maximum above
   four rather than reducing capacity without traffic evidence.
3. Change only the release image and revision suffix in the returned template.
   Create the revision against the observed resource version and retain existing
   configuration, traffic labels and rollback revisions.
4. Verify the exact image's source and browser configuration, then verify Azure
   provisioning and health before assigning traffic. Re-read live state before
   promotion so a concurrent release cannot be silently overwritten.
5. Verify the public source version, readiness, active revision scale and real
   authenticated account behavior after promotion. Keep the prior image and
   traffic receipt available for rollback.

The helper implements the initial activation profile. It does not claim that the
daily, telemetry-driven capacity optimizer has been deployed or accepted.
