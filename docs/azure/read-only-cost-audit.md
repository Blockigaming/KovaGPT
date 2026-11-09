# Azure cost audit — read-only, no feature changes

This source is a manual diagnostic, **not** a production change or a spending cap.
It never deploys, stops, resizes, or deletes any Azure resource.

After its PR is merged, run **Actions > Read-only Azure production cost audit >
Run workflow** on **main** and enter **READ_ONLY**. The protected production
GitHub OIDC identity is required. The workflow verifies the selected Azure
subscription and returns month-to-date actual charges grouped by **ServiceName**
and **ResourceId**, plus safe configuration metadata for Container Apps,
scheduled jobs, Container Apps environments, Log Analytics and Azure AI accounts
in the current Kova resource groups.

The workflow publishes a seven-day-retained artifact containing the report, and
displays up to five leading services in the protected GitHub job summary.
Resource IDs and billed amounts may be private: do not post the artifact publicly.

From an already authorized Azure Cloud Shell or terminal, you can run the same
read-only collection directly:

~~~sh
node scripts/azure/read-production-costs.mjs
~~~

Optionally set KOVA_EXPECTED_SUBSCRIPTION_ID before invocation to reject
an unexpected Azure subscription. A missing permission, unsupported cost query,
or paginated response is reported as unavailable or incomplete, **never** as a
zero-dollar bill. Azure cost data can lag the resource activity that created it.

## Decisions that require separate owner approval

- Do not change the one-minute scheduler cadence, disable tasks or reduce
  customer-facing capacity in order to save costs.
- Do not delete model deployments, modify model routing or purchase reservations
  based on this audit alone.
- Do not apply the migration-frozen production Bicep template to the active
  website; it is not a safe configuration-preserving release mechanism.
- Do not lower Log Analytics caps or stop security/audit monitoring. Azure warns
  that hard ingestion caps can interrupt monitoring.
- Do not delete unused images or rollback revisions until recovery evidence and
  retention requirements are reviewed.

Azure budgets provide **alerts**, not a hard spending ceiling. Prioritize
identifying exact resource and meter costs, then propose changes retaining the
existing feature and performance acceptance criteria.

References: Microsoft Cost Management Query REST API 2025-03-01; Azure
Container Apps billing; Azure AI provisioned throughput billing.
