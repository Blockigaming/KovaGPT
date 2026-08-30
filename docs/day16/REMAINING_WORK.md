# KovaGPT Exact Remaining Work

**As of:** 2026-08-30

## Truth boundary

- **Authoritative overall final-goal progress:** **14.6% complete / 85.4% remaining**.
- That percentage is the standing weighted final-product metric. It is not replaced by source-test or gate counts.
- The Day 16 master ledger currently contains **30 required high-level gates: 12 verified and 18 remaining**.
- The 18 high-level gates are not 18 simple tasks. This register decomposes them into **84 dependency-ordered remaining execution packages**.
- KovaGPT cannot be called complete until the actual deployed production system satisfies the final specification and is independently verified against the exact release SHA.

## Exact counts

| Measure                               |               Exact current value |
| ------------------------------------- | --------------------------------: |
| Overall final-goal completion         |                         **14.6%** |
| Overall final-goal remaining          |                         **85.4%** |
| Required high-level gates             |                            **30** |
| Verified high-level gates             |                            **12** |
| Remaining high-level gates            |                            **18** |
| Source gates                          | **12 / 13 verified; 1 remaining** |
| Production gates                      | **0 / 17 verified; 17 remaining** |
| Granular remaining execution packages |                            **84** |
| Local source-closure packages         |                             **9** |
| Product-implementation packages       |                            **33** |
| Release-candidate/data packages       |                            **10** |
| Azure-staging packages                |                            **12** |
| Production-cutover packages           |                            **20** |
| Potentially cost-bearing packages     |                            **13** |
| Lovable credits permitted             |                             **0** |

## Exact remaining high-level gates

|   # | Gate                                       | Verification | Current status              |
| --: | ------------------------------------------ | ------------ | --------------------------- |
|   1 | `local_visual_runtime_matrix`              | source       | `in_progress`               |
|   2 | `real_approved_testimonials`               | production   | `blocked_external_evidence` |
|   3 | `feature_to_subscription_live_attribution` | production   | `unverified_runtime`        |
|   4 | `production_visual_runtime_matrix`         | production   | `unverified_runtime`        |
|   5 | `azure_staging_deployment`                 | production   | `unverified_runtime`        |
|   6 | `azure_production_deployment`              | production   | `unverified_runtime`        |
|   7 | `cloudflare_production_route`              | production   | `unverified_runtime`        |
|   8 | `production_supabase_target`               | production   | `unverified_runtime`        |
|   9 | `production_gpt56_sol`                     | production   | `unverified_runtime`        |
|  10 | `production_tools_multimodal`              | production   | `unverified_runtime`        |
|  11 | `production_auth`                          | production   | `unverified_runtime`        |
|  12 | `production_billing`                       | production   | `unverified_runtime`        |
|  13 | `production_scheduled_workers`             | production   | `unverified_runtime`        |
|  14 | `production_observability`                 | production   | `unverified_runtime`        |
|  15 | `production_rollback`                      | production   | `unverified_runtime`        |
|  16 | `production_backup_recovery`               | production   | `unverified_runtime`        |
|  17 | `exact_sha_ci`                             | production   | `unverified_runtime`        |
|  18 | `production_no_p0_p1`                      | production   | `unverified_runtime`        |

## Visual acceptance calculation

The minimum automated final matrix encoded by `playwright.release.config.ts` is:

- **3 browser engines** × **8 viewports** = **24 projects per authentication state**.
- Each project executes **2 theme shell tests**, producing **48 primary shell executions per authentication state**.
- One representative route sweep and one API-boundary probe add **2 active executions per authentication state**.
- **50 active executions per authentication state** × **2 authentication states** = **100 minimum active acceptance executions**.
- Free, Plus, and Pro entitlement transitions still require targeted signed-in journeys even when they are not each expanded into a separate 100-test matrix.

## Current migration calculation

- Local release manifest: **83 migrations**.
- Last captured production migration evidence: **82 migrations**.
- Known new forward migration: `20260829163000_testimonial_collection_system.sql`.
- Production history must be re-fetched before any change. A backup and restore rehearsal must pass before applying a missing forward migration.

## Current UI-audit calculation

The 2026-08-28 audit contains **29 issues**. The conservative current classification is:

- **23 definitely open**.
- **3 code-fix candidates pending fresh rendered verification:** KOVA-AUD-026, KOVA-AUD-027, KOVA-AUD-028.
- **1 source-fixed but production-proof pending:** KOVA-AUD-020, zero-Lovable runtime removal.
- **2 explicit scope decisions required:** KOVA-AUD-021 Voice and KOVA-AUD-022 Enterprise.

This classification must be regenerated after the local authenticated browser matrix and again after staging. It is not permission to close any issue without evidence.

## Cost-minimized execution policy

- **GitHub Actions:** zero further runs until local and staging evidence pass. Execute exactly one manual final-release workflow against the production SHA.
- **Azure:** one consolidated minimal staging rehearsal, one production promotion, and only the rollback exercise required for evidence. Scale down or remove staging after verification.
- **ACR:** build and push one exact immutable candidate unless its digest already exists and is proven.
- **Lovable:** no prompts, runtime, hosting, gateway, package, workflow, or credits. **Budget: 0 credits.**

## Granular remaining execution packages

### Phase A — Local source closure

| ID    | Gate                          | Owner/boundary          | Cost                           | Work package                                                                                                            | Acceptance                                                                                          |
| ----- | ----------------------------- | ----------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `A01` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Synchronize the latest checkpoint and prove a clean branch/index                                                        | Local HEAD equals remote checkpoint; no tracked or staged changes.                                  |
| `A02` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Run targeted format, lint, type and unit checks for the latest audit-log, browser-diagnostic and remaining-work changes | All directly affected source/tests pass locally.                                                    |
| `A03` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Generate the machine-readable remaining-work snapshot from MASTER_LEDGER                                                | Remaining-work JSON/Markdown reports 30 required, 12 verified and 18 remaining gates.               |
| `A04` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Build the exact current checkpoint SHA with the Node/Azure production preset                                            | Production build succeeds and embeds the exact SHA.                                                 |
| `A05` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Run the repository-resident WebKit hydration/runtime diagnostic                                                         | WebKit reaches hydration=ready with no fatal same-origin page/resource failures.                    |
| `A06` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Run the signed-out Chromium, Firefox and WebKit matrix engine-by-engine                                                 | 50 active signed-out acceptance tests pass: 48 shell/theme cases plus route sweep and API boundary. |
| `A07` | `local_visual_runtime_matrix` | `user_external_account` | free/local or existing account | Create a lawful disposable signed-in release storage state without committing credentials                               | KOVA_RELEASE_AUTH_STATE points to a valid, private, disposable authenticated state.                 |
| `A08` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Run the signed-in Chromium, Firefox and WebKit matrix engine-by-engine                                                  | 50 active signed-in acceptance tests pass: 48 shell/theme cases plus route sweep and API boundary.  |
| `A09` | `local_visual_runtime_matrix` | `assistant+local`       | free/local or existing account | Record browser evidence and promote local_visual_runtime_matrix only after both auth matrices pass                      | Durable exact-SHA evidence exists and the source ledger becomes 13/13.                              |

### Phase B — Remaining product implementation

| ID    | Gate                           | Owner/boundary         | Cost                           | Work package                                                                                                         | Acceptance                                                                                                 |
| ----- | ------------------------------ | ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `B01` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Implement the canonical Work forward migration around agent_jobs                                                     | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B02` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Implement owner-scoped transactional Work creation and command RPCs                                                  | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B03` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Implement fenced Work leasing, heartbeat, checkpoint, event and settlement RPCs                                      | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B04` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Retire or freeze the incompatible legacy agent_runs ingress/runtime                                                  | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B05` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Build the dedicated Azure Work worker runtime                                                                        | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B06` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Pin Work model execution to managed-identity GPT-5.6 Sol with no direct-key fallback                                 | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B07` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Implement deny-by-default Work tool policies and bounded approval contracts                                          | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B08` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Implement durable Work evidence, artifact, checksum and private-storage contracts                                    | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B09` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Harden the isolated browser pool against SSRF, egress, downloads, credentials and lease loss                         | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B10` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Implement Work accounting, quotas, budgets, retries and reconciliation                                               | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B11` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Complete Work UI creation, pause, resume, cancel, retry, approval and failure recovery                               | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B12` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Add Work realtime/history pagination, structured failure and terminal-result evidence                                | Work is no longer a history-only disabled surface and passes isolated staging execution evidence.          |
| `B13` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Add the scheduled-task production execution migration and least-privilege owner RPCs                                 | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B14` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Implement IANA timezone, recurrence, DST and missed-run semantics                                                    | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B15` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Implement atomic occurrence claim, attempt, heartbeat, retry and settlement RPCs                                     | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B16` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Build the dedicated one-shot scheduled-worker entry point                                                            | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B17` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Wire the Azure Container Apps scheduled Job to the immutable worker image                                            | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B18` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Enforce entitlement, concurrency, retry and cancellation rules at claim time                                         | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B19` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Complete task editing, resume/retry, execution history and delivery UI                                               | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B20` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Implement scheduler heartbeat/readiness, metrics, alerts and stale-job detection                                     | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B21` | `production_scheduled_workers` | `assistant+local`      | free/local or existing account | Add scheduler duplicate-claim, lease-expiry, DST, retry, downgrade and two-user tests                                | A real Azure-scheduled occurrence executes once, records history/delivery and survives retry/cancel cases. |
| `B22` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Decide Maps scope: ship an accessible licensed map provider or remove the product surface and classify it truthfully | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B23` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Decide and implement/exclude sandboxed data analysis and code execution with truthful capability copy                | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B24` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Complete or explicitly scope Custom Kova authoring, knowledge, tools, ownership, preview and publishing states       | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B25` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Complete or truthfully scope adaptive Study workflows, quizzes, progress and incorrect-answer feedback               | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B26` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Prove Google/GitHub connector OAuth, scope, expiry, revoke, reconnect, sync and outage flows                         | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B27` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Prove Files/Library ownership, MIME spoofing, extraction failures, large-file limits and removal races               | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B28` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Prove Memory enable/disable and Temporary Chat no-read/no-write behavior across sessions                             | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B29` | `production_tools_multimodal`  | `assistant+local`      | free/local or existing account | Complete artifact create/edit/version/restore/export and storage-failure recovery                                    | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B30` | `production_no_p0_p1`          | `assistant+local`      | free/local or existing account | Resolve unnamed and undersized interactive controls found by the UI audit                                            | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B31` | `production_no_p0_p1`          | `user_external_device` | free/local or existing account | Run and remediate physical-device safe-area, keyboard, rotation, zoom and 200% text tests                            | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B32` | `production_observability`     | `assistant+local`      | free/local or existing account | Connect status/support surfaces to independently verifiable delivery and telemetry                                   | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |
| `B33` | `production_no_p0_p1`          | `assistant+local`      | free/local or existing account | Refresh the 29-issue UI audit and close only issues with rendered or production evidence                             | The relevant final-goal surface is functional, truthful and evidenced or explicitly approved as N/A.       |

### Phase C — Release candidate and Supabase safety

| ID    | Gate                         | Owner/boundary              | Cost                           | Work package                                                                                               | Acceptance                                                                               |
| ----- | ---------------------------- | --------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `C01` | `production_no_p0_p1`        | `assistant+web_research`    | free/local or existing account | Refresh the current ChatGPT/OpenAI parity matrix shortly before release                                    | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C02` | `exact_sha_ci`               | `assistant+github`          | free/local or existing account | Reconcile the checkpoint into a minimal clean main-branch release history                                  | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C03` | `exact_sha_ci`               | `assistant+github`          | free/local or existing account | Freeze one exact clean release SHA and source tree                                                         | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C04` | `production_supabase_target` | `user_supabase_credentials` | free/local or existing account | Fetch and reconcile the production Supabase migration list                                                 | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C05` | `production_backup_recovery` | `user_supabase_credentials` | free/local or existing account | Create and checksum a fresh production Supabase backup                                                     | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C06` | `production_backup_recovery` | `user_supabase_credentials` | free/local or existing account | Complete a disposable Supabase restore rehearsal                                                           | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C07` | `production_supabase_target` | `assistant+local`           | free/local or existing account | Run a fresh-database migration/schema/reference test through all 83 local migrations                       | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C08` | `production_supabase_target` | `user_supabase_credentials` | free/local or existing account | Run the executable two-user RLS and ownership isolation suite                                              | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C09` | `production_supabase_target` | `user_supabase_credentials` | free/local or existing account | Apply only reviewed forward migrations missing from production and prove the exact production project ref  | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |
| `C10` | `real_approved_testimonials` | `external_customer`         | free/local or existing account | Collect at least one genuine customer-approved testimonial through the implemented consent/review workflow | Sanitized exact-target evidence is recorded; no secret or customer content is committed. |

### Phase D — Minimal-cost Azure staging rehearsal

| ID    | Gate                               | Owner/boundary              | Cost                           | Work package                                                                                                 | Acceptance                                                                                                               |
| ----- | ---------------------------------- | --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `D01` | `production_gpt56_sol`             | `user_azure_credentials`    | possible spend                 | Verify Azure subscription access, regional quota and the approved GPT-5.6 Sol/image/embedding deployments    | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D02` | `azure_staging_deployment`         | `assistant+local`           | free/local or existing account | Build the exact release image locally and scan it for secrets                                                | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D03` | `azure_staging_deployment`         | `user_azure_credentials`    | possible spend                 | Push one immutable image to ACR and resolve repository@sha256 digest/provenance                              | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D04` | `azure_staging_deployment`         | `user_azure_credentials`    | free/local or existing account | Run and review the staging Azure what-if plan                                                                | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D05` | `azure_staging_deployment`         | `user_azure_credentials`    | possible spend                 | Deploy the exact digest to minimal-cost Azure staging                                                        | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D06` | `azure_staging_deployment`         | `user_azure_credentials`    | free/local or existing account | Verify staging health, readiness, exact SHA, managed identity, RBAC and intended Supabase target             | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D07` | `production_auth`                  | `user_test_accounts`        | free/local or existing account | Run staging auth, MFA/recovery, billing, connectors and multi-principal journeys                             | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D08` | `production_tools_multimodal`      | `user_provider_credentials` | possible spend                 | Run staging GPT-5.6 Sol streaming, stop/retry/fault injection, search, research, files, images and citations | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D09` | `production_scheduled_workers`     | `user_azure_credentials`    | possible spend                 | Run staging Work and Scheduled Tasks end-to-end with history, retry, cancellation and delivery evidence      | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D10` | `production_visual_runtime_matrix` | `user_test_accounts`        | free/local or existing account | Run signed-out and signed-in staging browser matrices                                                        | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D11` | `production_observability`         | `user_azure_credentials`    | free/local or existing account | Verify staging logs, metrics, alerts, liveness/readiness and correlation                                     | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |
| `D12` | `production_rollback`              | `user_azure_credentials`    | possible spend                 | Exercise staging rollback to a distinct immutable image and triage every P0/P1                               | Staging evidence is tied to the exact SHA/digest; resources are scaled down or removed after the consolidated rehearsal. |

### Phase E — Production cutover and final evidence

| ID    | Gate                                       | Owner/boundary                    | Cost                           | Work package                                                                                                               | Acceptance                                                                                                                             |
| ----- | ------------------------------------------ | --------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `E01` | `production_backup_recovery`               | `user_supabase_credentials`       | free/local or existing account | Take and verify the immediate pre-production Supabase backup                                                               | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E02` | `azure_production_deployment`              | `user_azure_credentials`          | possible spend                 | Deploy the exact immutable digest to Azure production with generation, domains and scheduler initially gated               | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E03` | `azure_production_deployment`              | `user_azure_credentials`          | free/local or existing account | Verify production health, readiness, exact SHA/tree/digest, RBAC and capability map                                        | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E04` | `cloudflare_production_route`              | `user_cloudflare_credentials`     | free/local or existing account | Route apex and www through Cloudflare, prove TLS/proxy/WAF and restrict Azure ingress to current Cloudflare CIDRs          | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E05` | `production_gpt56_sol`                     | `user_azure_credentials`          | possible spend                 | Enable generation only after readiness and prove GPT-5.6 Sol identity, streaming and usage evidence                        | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E06` | `production_scheduled_workers`             | `user_azure_credentials`          | possible spend                 | Enable the scheduled Azure Job only after fresh scheduler heartbeat/readiness                                              | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E07` | `production_auth`                          | `user_test_accounts`              | free/local or existing account | Verify signup, login, OAuth, recovery, MFA, refresh and deletion in production                                             | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E08` | `production_billing`                       | `user_stripe_test_account`        | free/local or existing account | Verify checkout, webhook, entitlement, portal, cancellation, past-due and recovery in production                           | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E09` | `production_tools_multimodal`              | `user_test_accounts`              | possible spend                 | Verify search, citations, tools, files, vision, images, research, connectors and storage in production                     | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E10` | `production_tools_multimodal`              | `user_test_accounts`              | possible spend                 | Verify Work execution in production if retained in final scope                                                             | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E11` | `production_visual_runtime_matrix`         | `user_test_accounts`              | free/local or existing account | Run the 100 active production browser acceptance executions across signed-out and signed-in states                         | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E12` | `feature_to_subscription_live_attribution` | `user_stripe_test_account`        | free/local or existing account | Prove production feature-use to confirmed-subscription attribution                                                         | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E13` | `real_approved_testimonials`               | `external_customer`               | free/local or existing account | Moderate and publish only genuine consented testimonial content                                                            | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E14` | `production_observability`                 | `user_azure_credentials`          | free/local or existing account | Verify production logs, metrics, alerts, liveness/readiness, tracing and independent status telemetry                      | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E15` | `production_rollback`                      | `user_azure_credentials`          | possible spend                 | Exercise and verify production rollback to the previous immutable image, then restore the approved release                 | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E16` | `production_backup_recovery`               | `user_supabase_credentials`       | free/local or existing account | Verify backup integrity and recovery procedure against production-compatible evidence                                      | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E17` | `production_no_p0_p1`                      | `assistant+production_read`       | free/local or existing account | Scan production HTML, network, bundles, logs, routes and configuration for zero active Lovable dependency                  | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E18` | `production_no_p0_p1`                      | `assistant+production_read`       | free/local or existing account | Complete final P0/P1 triage and prove no known production P0 or P1 defects                                                 | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E19` | `exact_sha_ci`                             | `user_github_environment_secrets` | possible spend                 | Run the single manual exact-SHA GitHub final release workflow once                                                         | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |
| `E20` | `production_no_p0_p1`                      | `assistant+github`                | free/local or existing account | Assemble the evidence index, mark only proven ledger items verified_production, and declare completion only if zero remain | Exact production SHA evidence passes; no secret data is exposed; the operation is not repeated without a source change or failed gate. |

## Dependency order

1. Finish Phase A and reach 13/13 source gates.
2. Complete Phase B feature scope before enabling disabled Work, Scheduled Tasks, Maps, data analysis, or assistant capabilities.
3. Freeze the exact release candidate and complete Phase C data safety/reconciliation.
4. Run one consolidated Phase D staging rehearsal. Fix findings locally before another deployment.
5. Perform Phase E production cutover using the same immutable digest, then run the single manual exact-SHA GitHub workflow.

## External prerequisites that cannot be fabricated

- A lawful disposable signed-in browser state.
- Azure, Supabase, Cloudflare, Stripe, Google/GitHub OAuth, and production environment access where required.
- Real provider quota and deployments.
- Real customer consent for testimonial publication.
- Physical-device and assistive-technology access for the final accessibility/device checks.

## Completion rule

`100% complete` is valid only when the remaining-work calculator reports zero required gates, every production gate is `verified_production` or explicitly approved `not_applicable`, the exact production SHA passes the one final manual workflow, and the production evidence index contains no unresolved P0/P1 defect.
