# Work execution v2 source checkpoint

## Scope completed in this source slice

Work v2 uses `agent_jobs` as the canonical durable queue. It adds owner-scoped
creation and lifecycle RPCs, entitlement snapshots, idempotency, bounded token
budgets, opaque lease tokens, state-version fencing, separate attempts,
heartbeats, ordered checkpoints, safe events, approval records, evidence
metadata, explicit retry settlement, expired-lease recovery, worker readiness,
and exact-source-SHA runtime activation.

The dedicated one-shot worker is bundled into the same immutable application
image as the web and Scheduled Tasks runtimes. It requires Azure Container Apps,
Azure managed identity, the approved deep deployment, an exact source SHA, and
an explicit enable flag. Direct OpenAI and Azure OpenAI API-key paths are
rejected for Work.

The first executable worker stage is deliberately model-only. It can perform
bounded reasoning and writing. A Work job that requests browser or external tool
execution fails safely with a policy result; the worker does not pretend an
external action occurred. The existing incompatible `agent_runs` ingress and
browser executor remain fail-closed.

The web surface remains disabled by default. After later schema, image, worker,
heartbeat, and canary evidence, operations may explicitly set both the database
runtime control and `KOVA_WORK_EXECUTION_ENABLED=1`. Until then, the Work page
continues to show historical records. When the explicit runtime gate is enabled,
the source supports model-only creation, pause, resume, cancel, delete, and
approval decisions.

## Not proven by this source slice

This work is not production or staging evidence. No migration has been applied,
no Azure Job has been deployed, no model call has been made, no browser pool has
run, and no production ledger item is promoted.

The following remain release blockers:

- an isolated browser/tool runtime with deny-by-default egress, SSRF protection,
  download and credential controls, and lease-loss shutdown;
- transactional tool-call completion and evidence upload/storage RPCs;
- usage reservation, billing reconciliation, and plan downgrade handling under
  real concurrency;
- Azure Container Apps Job wiring, alerts, scaling, and rollback evidence;
- two-user database isolation and disposable restore rehearsal;
- staging model identity, fault injection, approval, retry, cancellation, and
  worker-death exercises;
- rendered Work UI verification and the final signed-in browser matrix;
- exact production SHA, digest, revision, telemetry, and rollback proof.

## Cost and activation rule

This source slice must be verified locally before any paid infrastructure step.
It uses no Lovable credits and should not dispatch GitHub Actions. Azure staging
is reserved for one consolidated rehearsal after the remaining Work tool/browser
source and release candidate are frozen.
