# Unified Work execution protocol

This source package adds one Work execution control plane. It does not enable
the legacy `agent_jobs`, `agent_runs`, browser worker, team worker, or scheduler.
The existing saved planning sessions remain `work_saved_records` rows with
`kind = 'session'`; runner evidence never becomes a user-authored planning event.

## Owner API and durable state

`/api/work/execution` authenticates the caller, rejects cross-site mutations,
bounds JSON, applies distributed rate limits, and returns private responses.
Chat and Work expose the same execution panel and use the same submission shape:

```json
{
  "operation": "submit",
  "input": {
    "mutationId": "UUID",
    "objective": "Prepare the requested output",
    "source": "work",
    "sessionId": null,
    "sessionRevision": null,
    "projectId": "UUID"
  }
}
```

`source` may also be `chat`. A session reference must match a current owner
session and its exact acknowledged revision. The server retrieves a bounded immutable objective/context/steps snapshot, and the admission RPC rechecks that snapshot under the same session row lock. Local pending edits are not confirmed execution input. It does not establish ownership
of a local-only chat. A Project target must grant current owner/editor access.
The server resolves entitlement, model and limits; caller-supplied models,
tool lists, URLs as execution authority, prices, and budgets are rejected.

`work_execution_runs`, append-only `work_execution_events`, and internal
`work_execution_receipts` are committed together by a service-only CAS RPC.
Owner RLS permits reads, never state/event forgery. Account admission uses the
same deletion lock as account Storage operations and the narrow private Auth
helper; it does not require `service_role` to read `auth.users` directly.
Mutation identifiers are bound to the complete operation hash. Retries return
the current state and the revision originally applied.

Owner commands cover cancellation, pause, resume, queued direction insertion,
editing/removal, exact-question answers, and approval/denial. Directions cannot
be edited after the runner acknowledges them. Approvals bind one action
revision, canonical UTF-8 JSON, SHA-256 and expiration; they never grant blanket
provider permission. Consuming approval records an external effect before
execution. Cancel and lease recovery preserve ambiguous effects and accounting
reservations for evidence-based reconciliation rather than replaying them.

## HTTPS runner contract

Execution is disabled by default. A reviewed deployment must supply all of:

- `KOVA_WORK_RUNNER_ENABLED=true`
- `KOVA_WORK_RUNNER_ORIGIN`: exact operator-controlled HTTPS origin, no path,
  credentials, alternate port, IP literal, or local/private host name
- `KOVA_WORK_RUNNER_ID`: pinned runner UUID
- `KOVA_WORK_RUNNER_BUILD`: pinned 40–64 character hexadecimal build digest
- `KOVA_WORK_RUNNER_TOKEN`: dedicated server-only bearer token, 32–512 characters
- `KOVA_WORK_RUNNER_SIGNING_KEY`: dedicated server-only HMAC key, 32–512 characters

The flag alone cannot admit a job. The configured origin must return a signed,
current `kova-work-v1` heartbeat with the pinned identity/build and all required
capabilities. Missing, diagnostic, stale, unsigned, or incompatible responses
yield unavailable; no new queued row is created. Credentials are never exposed
to browsers or stored in run state, exports, logs, or notification previews.

The transport implements POST operations under `/v1/work/`:

| Operation       | Required behavior                                                             |
| --------------- | ----------------------------------------------------------------------------- |
| `heartbeat`     | Current authenticated protocol, build and capability readiness                |
| `dispatch`      | Durable queue wakeup; backend drain recovers lost wakeups                     |
| `owner_cleanup` | Retire an account, abort/drain its attempts, and erase remote private records |
| `submit`        | Idempotent bounded reasoning attempt, exact owner/run/epoch/step/input hash   |
| `status`        | Authenticated bound attempt state and terminal receipt                        |
| `cancel`        | Idempotent cancellation; acknowledgement must not fabricate completion        |
| `reconcile`     | Return verified terminal evidence or explicit `unknown`; never replay         |
| `artifact`      | Bound output descriptor and bounded base64 bytes, no download URL             |

Requests contain `{protocol, runnerId, build, requestId, at, operation, payload}`.
Their exact canonical JSON bytes are HMAC-SHA-256 signed with the prefix
`kova-work-v1:request\n`. Responses contain the same protocol, runner identity,
build, request identifier and a current timestamp plus `payload`; their exact
UTF-8 response body is signed with `kova-work-v1:response\n`. Signatures use
`X-Kova-Signature` and are verified before JSON use. Redirects are rejected,
requests time out, response streams are byte-bounded, and replayed nonces or
timestamps outside the response window are rejected. Request replay inside the short signature window still binds to the same durable attempt and cannot create another provider call.

Attempts bind `{runId, ownerId, epoch, stepId, inputHash}`. The receiver must
persist idempotency by run/epoch/step/operation and reject changed payloads.
An `unknown` attempt is unresolved, never permission to repeat an external
effect. Completed receipts bind the accounting reservation and the same attempt,
include bounded integer usage, and contain at most twenty artifact descriptors.

`executeIsolatedWorkStep` and `executeConfiguredWorkRun` provide the coordinator
source. They require current authorization, a valid lease, a durable reservation
from the existing AI accounting broker, successful state CAS and repeated lease
checks before provider execution. Every step has a unique used reservation and
step ID. Resource reservations conservatively consume the run budget. Successful
accounting and a verified receipt are recorded before output publication.
`recoverConfiguredWorkRun` reconciles a lost attempt from signed status rather
than blindly submitting it again.

`work-runner/entrypoint.mjs` is the actual standalone TLS service, not an empty
adapter registry. It maintains signed backend probe/drain calls through
`/api/internal/work-execution`. This endpoint derives each owner from the stored
run, verifies current Auth state, and dispatches/reconciles one bounded run. The
runner heartbeat requires a fresh successful backend probe and Docker/runsc probe;
a configuration boolean cannot supply readiness. The loop independently drains
the database queue after lost individual wakeups.

`service.mjs` persists accepted attempt identity before invoking a provider. A
restart observes unknown interrupted attempts and never automatically invokes
them again. Concurrent duplicate submissions serialize around the same durable
record. Cancellation and late receipt writes also serialize. Receipts contain
known provider usage even when document conversion or provider JSON is invalid.
Empty completed output is accounted and durably failed, never replayed.

`provider.mjs` implements the configured Responses HTTPS call, strict structured
question/action/output parsing, and actual document rendering. Reserved output
tokens are a separate hard provider request limit; final usage is recomputed with
the server catalog. `settle_work_accounting` is evidence-bound and idempotent after
crashes, stale reservations, and earlier canonical completion; changed totals
reject. An overrun is recorded before the Work run fails.

A settled question or approval request and removal of its step happen in one
state commit. Owner approval binds the exact canonical input and revision. Starting
the approved step atomically consumes it and records the effect. Its verified
result queues the next reasoning step; it cannot consume the approval twice.

`action-broker.mjs` implements pinned typed HTTPS API operations and a text browser.
Each operation fixes the full HTTPS URL, method, response type, and action kind in
operator configuration. The approval displays those exact bytes plus the body.
Mutations/private reads require a current owner-specific operation grant; a shared
operator credential is not user permission. Redirects are disabled, responses are
bounded, and text browsing does not execute scripts, follow links, or sign in.
Public GET operations may explicitly omit credentials. Full interactive browser
sessions and authentication takeover are unsupported by this implementation.

`work-runner/sandbox-container.mjs` implements actual isolated Python/CSV execution
using the fixed Docker engine and required runsc runtime. Source and input bytes
travel only through stdin into fresh container tmpfs. The container is non-root,
network-disabled, read-only at its root, and constrained by CPU, memory, process,
wall-time, output and concurrency limits. It has no host data mounts or shell
command construction. Every run independently checks the exact pinned image and
runtime. Cancellation reaps its named container; uncertain cleanup quarantines
new execution until recovery succeeds. `work-sandbox-ci.yml` includes a real
container acceptance job; unit fakes are not a substitute for that job.

## Real output publication

Output descriptors are `{artifactId, sha256, mimeType, bytes}` and are bound to
the exact owner/run/epoch/step/input hash. The transport independently hashes
decoded bytes and checks size/MIME/binding. The per-artifact limit is 10 MiB.

`publishWorkProjectOutput` passes verified bytes through the canonical Project
file upload lifecycle: current membership and deletion fences, quota reservation,
unique immutable generation, Storage upload, downloaded-byte SHA-256 verification,
and atomic ready settlement. It then creates an owner Library row and a separate
service-owned `work_execution_outputs` record. Neither a Storage URL nor editable
Library metadata can authorize publication or download.

The Library download action calls `/api/work/output`, reads the immutable binding,
checks the caller's current ready Project-file access and digest, and signs through
the caller-scoped Storage client for 60 seconds. Revoked Project access, deletion,
or changed provenance prevents signing. Completion independently verifies the
run's bound outputs and current access. In-app completion/question notifications
are atomic, private, idempotent, and respect preferences; no email is claimed sent.

The bundled Office adapter calls the shared PDF/DOCX/XLSX/PPTX byte writers and injects local font bytes. Isolated analysis outputs also pass through the same byte hashing and publisher. The runner caps all artifacts in one attempt at 6 MiB; the transport independently allows no single artifact over 10 MiB. Site publication is a separate authority and must be verified through
the Sites publication RPC before adding a Site output type; a URL is insufficient.

## Local build and service configuration

After the shared document writer package is integrated, build its Node wrapper
with `node work-runner/build.mjs`. Run `node work-runner/entrypoint.mjs` only on the
reviewed isolated deployment. Required additional server configuration is:

- `KOVA_WORK_BACKEND_ORIGIN`: the exact KovaGPT HTTPS origin.
- `KOVA_WORK_RESPONSES_URL`, `KOVA_WORK_PROVIDER_KEY`, `KOVA_WORK_MODELS`: the reviewed provider endpoint, credential and allowed catalog model identifiers.
- `KOVA_WORK_SANDBOX_IMAGE`: immutable local image ID or registry digest. Docker and runsc must be installed and the pinned image already present; runtime never pulls an image.
- `KOVA_WORK_STATE_DIR`: absolute private durable directory for attempt receipts and temporary artifact bytes.
- `KOVA_WORK_TLS_KEY_FILE`, `KOVA_WORK_TLS_CERT_FILE`: server identity files; `KOVA_WORK_LISTEN_PORT` defaults to 8443 behind the reviewed HTTPS origin.
- Optional `KOVA_WORK_OPERATIONS_JSON`: typed operation catalog (`id`, `action`, `method`, exact `url`, `response: text|json`, optional public GET).
- Optional `KOVA_WORK_GRANTS_FILE`: private JSON array of owner/operation-scoped token grants with `ownerId`, `operationId`, `token`, and `expiresAt`. No grant is created from model output.

Chat and Work controls synchronously abort their captured lifetime when the owner clears browser data, clear private drafts/results, and require an explicit reopen/reload. Work sync reads a bounded byte stream with cancellation before parsing JSON; an account switch never substitutes a new bearer.

Generated CSV and isolated CSV artifact bytes share a literal-cell validator. Formula-leading expressions, including malicious minus prefixes, are rejected; negative decimal/scientific numeric cells remain unchanged.

The private store has bounded records/bytes and never evicts uncertain attempts
to make room. Capacity exhaustion fails closed. Operator monitoring and lifecycle
handling must preserve unresolved evidence. `cleanupWorkRunnerOwner(ownerId)`
checks durable runs, uses the configured signed cleanup transport even when new
admission is disabled, and returns `{complete:boolean}`. Account deletion must
call it after the deletion fence and before metadata/Auth deletion, retrying while
it drains. Missing configuration or a different prior runner identity blocks cleanup. Normal build upgrades on the same stable runner identity do not block erasure.
The service permanently retires the owner before removing private receipts and
bytes, so a late completion cannot resurrect them. It stores no provider keys or
original prompts in the private attempt records.

## Remaining owner deployment work

### Bounded terminal commands

The configured Work provider may emit `kind: "terminal"` with an ordered list of
`{command, options, inputFile, outputFile}` operations and literal input files.
The supported commands are `wc`, `sort`, `uniq`, `head`, `tail`, `cut`, and
`sha256sum`. Options have typed bounds; executable paths, shell fragments,
environment variables, arbitrary arguments, absolute paths and overwrites are
not accepted. Each output may feed a later operation in the same eight-command
job. The result contains actual exit codes and downloadable output bytes.

`terminal.mjs` compiles this plan to a fixed subprocess driver inside the same
networkless Docker/runsc container used for Python. It never starts a host
command. No package installation, host terminal access or arbitrary shell is
advertised. Existing cancellation, deadlines, resource/output limits, accounting,
hash-verified publication and uncertain-attempt recovery apply unchanged.
The sandbox image build checks its fixed binaries. Hosted sandbox acceptance
executes a real sort/count pipeline; the local compiler smoke checks command
results and is not evidence of container isolation.

The executable source, fake-provider end-to-end tests, and source for hosted container acceptance do not prove a production deployment. Owner work remains selecting the hosting/provider account and deploying the implemented isolated runner/dispatcher,
configuring its secrets and exact origin/build, proving process/filesystem/network
isolation and cancellation, verifying provider billing/quotas, and explicitly
activating the reviewed configuration. No infrastructure or production migrations
were changed by this source package. The UI remains truthful while unavailable.

## Undispatched step recovery

A lost database response after `begin_step` never proves that admission failed. The broker retains its reservation unless PostgreSQL confirms a rolled-back revision conflict; a later absence read is insufficient because the original transaction may still commit.

The pinned runner must advertise `negative-execution-proof`. Its authenticated `seal_undispatched` operation serializes with submit and writes an immutable exact owner/run/epoch/step/input/reservation tombstone only if no attempt has ever been accepted. A late submit returns that same signed `not_executed` receipt and cannot invoke the provider. Existing accepted, running or unknown attempts stay uncertain. Tombstones live in the private durable attempt store and are purged only through permanent owner retirement.

Recovery requires that signed zero-use receipt, matching original runner build, and successful canonical accounting settlement before removing the persisted step. A started approval effect becomes `not_executed`; its one-use approval and attempt IDs remain consumed. A paused run may then receive a fresh explicit resume, while a cancelled run remains cancelled. Real usage, a mismatched receipt, failed settlement or an uncertain provider attempt cannot be rewritten as nonexecution.

The standalone Linux runner also requires `/usr/bin/flock`. Its readiness check acquires a real per-owner kernel lock in the configured durable volume before advertising readiness. Fixed lock helpers receive no task code and invoke no shell. Creation, private writes and provider activity hold the owner lock; retirement immediately persists the permanent denial marker, and physical erasure waits for every writer/activity on that volume to leave the lock. A paused writer cannot outlive an acknowledged purge, and process death releases the kernel lock rather than leaving an unsafe expiring lease.

## Model, reasoning and service controls

New Work admissions accept the logical `instant`, `normal`, `thinking`, or `deep` mode and an optional `reasoningEffort`; arbitrary client model IDs remain invalid. Instant/Normal resolve the configured `DEFAULT_CHAT` role, Thinking resolves `ADVANCED_REASONING`, and Deep resolves `PREMIUM_REASONING` and requires Pro. Work intentionally uses an exact role choice: prompt complexity cannot upgrade it, and an unavailable premium choice cannot downgrade. The account catalog, tools support, current plan, generation limits, and signed runner model capabilities must all permit the choice.

The isolated runner advertises its actual configured model allowlist. Optional `KOVA_WORK_MODEL_CAPABILITIES_JSON` is a bounded array of `{ "model": "configured-model-id", "reasoningEfforts": ["low", "medium", "high"], "maxOutputTokens": 8192 }`. Operators must include only efforts/output limits verified for their deployed provider endpoint and region. Without this metadata, each `KOVA_WORK_MODELS` entry supports provider-default effort only and the existing 8,192-token hard ceiling. This source configuration does not establish live quota or funding; existing runtime and accounting admission remain mandatory. No provider calls or configuration changes are made by preparing the source package.

A signed heartbeat's model capabilities are checked on admission, claim, resume, and before each reservation. The immutable run `modelSelection` records the mode, optional explicit effort, maximum output tokens per step and `provider_default` service. Mode/effort enter the request hash, and explicit effort enters each exact step hash. The provider sends `reasoning.effort` only for an advertised effort; omitted effort remains honestly labeled provider default. Accounting records the selected mode and exact catalog model. Current role or model capability drift rejects future execution instead of changing the run's model.

The interface displays the actual configured model, available reasoning choices and saved run selection. Service is provider default; no priority/fast tier or latency guarantee is offered or silently billed. Instant has a 1,200-token output ceiling, Normal 2,048, Thinking 4,096 and Deep 8,192, further bounded by runner/catalog/run budgets. Reasoning effort can affect both response time and token use, and supported values depend on the deployed model. [OpenAI reasoning documentation](https://developers.openai.com/api/docs/guides/reasoning).
