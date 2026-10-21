# Existing-host production email trigger proposal

This is a proposed operation against an existing resource, not a deployed timer or a successful invocation receipt. No cloud inventory or operation was repeated to prepare it. The source-owned worker implementation is `scripts/auth-email/production-worker.mjs`, its invocation contract is `docs/production-email-worker.md`, and the reviewed runtime COPY closure repair must be in the exact image used by the job.

## Existing candidate and collision gate

Existing source evidence in `docs/release-reconciliation/production-operation-approval-packets.md` identifies `kovagpt-scheduled-execution` in `rg-kovagpt-prod` as a **Manual** Container Apps job, observed September 24. This is historical evidence of an existing candidate, not proof of its current workload, authorization or state. The proposed existing resource is:

`/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-prod/providers/Microsoft.App/jobs/kovagpt-scheduled-execution`

There is no email-specific Azure Job/Bicep/cron configuration in the examined source. The source contains the fixed worker invoker and authenticated server endpoint; it does not create its trigger. The unrelated `/api/internal/scheduled-execution` application route is not the email worker endpoint.

Monitoring must qualify that this existing job is available for this dedicated workload before changing its trigger, command or image. Preserve an exact nonsecret before-state and private secret-reference custody. If it currently serves scheduled tasks or another consumer, stop this proposed modification and identify an existing authorized host that can add a separate execution without disrupting that workload. Do not repurpose it, create another resource or assert a working trigger on the basis of its name alone. This proposal supplies no current workload/permission observation; consume Monitoring's latest authenticated operator receipts instead of repeating completed access setup.

## Exact proposed dedicated job settings

After the collision gate, current installed-schema/recovery receipt and exact repaired production image qualification pass, propose this bounded dedicated configuration on the existing host. Consume completed installation evidence; do not replay the installer or require account adoption/full-project restore for the additive new-account first release:

| Setting                                 | Proposed value                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger type                            | `Schedule`                                                                                                                                           |
| Cron expression                         | `* * * * *` (UTC, once per minute)                                                                                                                   |
| Parallelism                             | `1`                                                                                                                                                  |
| Required replica completions            | `1`                                                                                                                                                  |
| Replica retry limit                     | `0`                                                                                                                                                  |
| Replica timeout                         | `150` seconds                                                                                                                                        |
| Command                                 | `node`                                                                                                                                               |
| Arguments                               | `/app/scripts/auth-email/production-worker.mjs`, `--execute`                                                                                         |
| Image                                   | Exact reviewed repaired image's immutable digest; not `db8ca` after applying repairs, and never a mutable tag alone                                  |
| Operator gate                           | `KOVA_EMAIL_WORKER_OPERATOR_ENABLED=true`                                                                                                            |
| Private operator binding                | `KOVA_EMAIL_WORKER_SECRET`, same dedicated existing secret version as the server endpoint; exact secret reference/identity to be qualified privately |
| Other provider bindings on the operator | None required; it does not need `RESEND_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY`                                                                      |

One-minute ticks may overlap a long execution. The existing database replay guard and 180-second lease serialize the endpoint; job parallelism alone is not a global cross-execution lock. The operator aborts its request after 120 seconds and the proposed 150-second host timeout ends the process before that lease expires. There are no host retries or wrapper loops. Each invocation has a new signed run UUID and the fixed body `{}`; endpoint selection, recipients, lane bounds and deadlines cannot be supplied by the scheduler. It can attempt at most one Auth email and one account notice per invocation, with existing RPC/send timeouts and provider idempotency rules.

Required server target settings, independently qualified on `kovagpt-prod-web`:

| Binding                                                        | Required value                                                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTAINER_APP_NAME`                                           | `kovagpt-prod-web`                                                                                                                                         |
| `AZURE_ENVIRONMENT`                                            | `production`                                                                                                                                               |
| `KOVA_AUTH_PUBLIC_ORIGIN`, `KOVA_AUTH_ORIGIN`                  | `https://kovagpt.com`                                                                                                                                      |
| `SUPABASE_URL`                                                 | `https://mfbycmbjygcfkrsuepxf.supabase.co`                                                                                                                 |
| `KOVA_EXPECTED_SUPABASE_PROJECT_REF`                           | `mfbycmbjygcfkrsuepxf`                                                                                                                                     |
| `KOVA_AUTH_MODE`                                               | Matching qualified browser/server `dual` during supported adoption; pure `kova` needs separate cutover evidence                                            |
| `KOVA_PRODUCTION_EMAIL_WORKER_ENABLED`                         | `true` only at qualified activation                                                                                                                        |
| `KOVA_AUTH_EMAIL_DISPATCH_ENABLED`, `KOVA_EMAIL_QUEUE_ENABLED` | `true` only at qualified activation                                                                                                                        |
| `KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED`                          | `true` only if optional account-notice lane is qualified                                                                                                   |
| Private server bindings                                        | Existing approved production `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, dedicated `KOVA_EMAIL_WORKER_SECRET`; exact references/versions remain private |

Sender stays `KovaGPT <noreply@kovagpt.com>`. Templates, all nine default-on preferences, saved opt-outs and requested recovery remain governed by existing source. Do not rotate or revoke any credential to establish this scheduler. The active independent `kova-one-recovery-dispatch` remains a distinct Resend consumer; app dispatcher flags do not disable it, and its credential identity remains a separate private verification before any old-key revocation.

## Private operator action and acceptance receipts

Monitoring needs a successfully authenticated Azure operator with access to inspect the exact existing job/workload and its before-state, approve the existing workload collision gate, and apply only the reviewed properties. The executing principal must already be authorized to update this job/start/read executions; the job identity must have the existing approved immutable-image pull and dedicated secret-reference access. Resolve actual reference names/versions and permissions privately; do not retrieve or print credential values or a complete Secrets-accessibility snapshot.

After qualified server/image/database bindings, apply the reviewed existing-host change once and observe real timer-driven executions. Retain nonsecret before/after trigger/settings/image-digest receipts, scheduled occurrence timestamps, execution IDs/status/end timestamps and the operator's fixed `{ok, claimed, attempted, runId}` receipt. A manual invocation or an accepted configuration update does not prove the timer. Verify actual recurring scheduled invocation, bounded completion and no host retry/overlap duplication. An empty-queue success proves invocation, not delivered email. Verification/reset/signup flows additionally need actual provider delivery and recipient-side completion receipts, followed by login/passkey/backend acceptance/revocation evidence.

On failure, suspend this dedicated trigger using the reviewed existing-host mechanism and retain failed/uncertain evidence; do not retry an uncertain send manually. Restore the recorded original trigger/command/image/bindings only if the workload collision gate established that this rollback is safe. Preserve secret versions, encrypted records and private custody. Production hosted Google login remains serving; staging stays stopped.

Current status: proposal written; existing host availability, current permissions, exact job image/secret reference, applied schedule and automatic invocation are **unqualified**. No schedule was created, no invocation occurred and no delivery receipt is claimed.
