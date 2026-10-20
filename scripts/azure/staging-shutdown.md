# Existing staging shutdown executor

`staging-shutdown.mjs` implements an explicit shutdown of the existing
`ca-kovagpt-staging` application in `rg-kovagpt-staging`. Importing it and running
its unit tests make no Azure requests. It creates no resource, deploys no image,
starts no application, reads no application secrets, and grants no spending or
deployment authorization. It does not change the Auth or Models allowances.

## What is implemented

An explicit invocation makes **one** authenticated ARM Stop request using
`az rest --method post`, pinned to API `2025-07-01` and the supplied approved
subscription UUID. The Azure CLI reference does not currently list an app-level
`az containerapp stop` command; the REST Stop operation is used directly.
The stop response body is suppressed. A successful request can mean the stop is
still in progress; acknowledgment is never treated as completion.

The executor then makes projected control-plane reads, with no app environment,
secrets, credentials or provider error bodies in its receipt. It requires two
consecutive complete observations of:

- App `properties.runningStatus === "Stopped"`, before and after each scan.
- Every revision page, including inactive and old revisions, without filtering.
- Every replica page for every revision, with a total replica count of zero.
- The same revision set before and after a scan and across both passing scans.

Continuation URLs must retain the exact ARM host, collection path and API
version. Each projected page must retain the original array length, preventing
null elements dropped by a projection from appearing as zero replicas.
Missing collections, malformed responses, repeated or excessive pages,
cross-scope IDs, failed commands and unfinished observations fail closed.
Each CLI command has at most 30 seconds, including termination on timeout; the
original deadline further narrows each read. A failed Stop request still leads
to bounded observations, but cannot produce `VERIFIED_STOPPED`.

The library function `withStagingShutdown(plan, {work, ...})` attempts the same
Stop and verification on work success, failure, cancellation, SIGINT, SIGTERM,
or the local acceptance cutoff. `work` receives an AbortSignal and must stop
issuing activation/revision writes when aborted. If it does not settle before
the Stop attempt begins, the result is `SHUTDOWN_UNVERIFIED`, even if it later
settles and a transient Stopped state was observed. The receipt's `workQuiesced`
field describes quiescence before Stop, never a check made after the final read.
This helper performs no acceptance itself.

## Original clock and explicit invocation

Before the **first operation that could start staging**, the externally reviewed
attempt must fix an original UTC `t0`, attempt UUID and source commit. A private
plan file contains only these nonsecret fields:

```json
{
  "version": 1,
  "subscriptionId": "APPROVED-SUBSCRIPTION-UUID",
  "targetId": "/subscriptions/APPROVED-SUBSCRIPTION-UUID/resourceGroups/rg-kovagpt-staging/providers/Microsoft.App/containerApps/ca-kovagpt-staging",
  "attemptId": "ORIGINAL-ATTEMPT-UUID",
  "sourceSha": "ORIGINAL-40-CHARACTER-SOURCE-COMMIT",
  "t0": "ORIGINAL-UTC-TIMESTAMP-WITH-MILLISECONDS",
  "stopAt": "ORIGINAL-UTC-ACCEPTANCE-CUTOFF",
  "hardDeadline": "ORIGINAL-UTC-SHUTDOWN-DEADLINE"
}
```

The example is intentionally invalid until real reviewed values are supplied.
The executor validates `stopAt <= t0 + 3300 seconds`,
`hardDeadline <= t0 + 3600 seconds`, and at least 300 seconds between cutoff and
hard deadline. UTC timestamps must use canonical `YYYY-MM-DDTHH:mm:ss.sssZ`.
Retries or resumed sessions must reuse the original packet. The executor cannot
prove a caller did not replace the original `t0`; the external attempt record
must establish that binding. Wall and monotonic clocks within each process
prevent a backward wall-clock adjustment from granting more time.

After shutdown authorization and target bindings have been reviewed, a qualified
operator or existing qualified supervisor can explicitly invoke:

```sh
node scripts/azure/staging-shutdown.mjs --execute-stop /absolute/private/attempt.json
```

There is no implicit/default live mode, login, deployment, start command, stop
retry, or separate email/provider allowance. The invocation writes one sanitized
JSON receipt to stdout and exits nonzero unless shutdown was verified within the
original deadline. Preserve the receipt in the existing private evidence path.
An invocation after the deadline still attempts one bounded emergency Stop to
reduce running exposure; it performs no reads and cannot certify an on-time
shutdown. It does not renew any authorization.

## What remains unqualified

**A local timer, `finally`, CLI timeout, or successful mocked test does not
establish independent shutdown.** The local helper and explicit CLI invocation
cannot survive process/host loss, SIGKILL, a suspended Cloud Shell, unavailable
Azure control plane, revoked credentials, or another writer starting staging
after the final read. The CLI's SIGINT/SIGTERM handlers preserve an ongoing stop
attempt while the process is alive. They are not a durable watchdog.

Every receipt therefore always contains
`independentDeadlineVerified: false` and `activationQualified: false`.
`VERIFIED_STOPPED` describes only the completed bounded observations; it is not
proof of a continuously stopped future state, a cost cap, or activation approval.

Before any activation, existing private evidence must identify an **already
available** execution controller that:

1. Runs the original attempt's Stop at or before `t0 + 3300 seconds`, independently
   of the activation/test process and an interactive browser/Cloud Shell session.
2. Retains valid authorization for the exact approved subscription and staging
   resource's Stop, application read, revision list and replica list operations.
3. Is armed and acknowledged before the first possible start; preserves the
   original deadline; captures its receipt; and does not restart staging.
4. Fences or conclusively quiesces activation/revision writers before cleanup,
   so a late completion cannot undo shutdown. This source cannot impose such a
   fence on an unrelated Azure operation or writer.
5. Can complete fresh Stopped-and-zero-replica verification by the original hard
   deadline. Failure remains `SHUTDOWN_UNVERIFIED` and requires operator handling.

No such controller, role assignment, armed deadline or target capability was
observed or created by this source-only work. If there is no existing qualified
controller, this prerequisite remains open; adding infrastructure would require
a separate reviewed decision. Do not set the preflight's
`stopSafeguardVerified` to true from these files or their offline tests alone.

## Offline validation and official references

```sh
node --test tests/unit/staging-shutdown.test.mjs
```

- [ARM Container Apps Stop](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps/stop?view=rest-resource-manager-containerapps-2025-07-01)
- [ARM Container Apps Get](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps/get?view=rest-resource-manager-containerapps-2025-07-01)
- [ARM List Revisions](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revisions/list-revisions?view=rest-resource-manager-containerapps-2025-07-01)
- [ARM List Replicas](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revision-replicas/list-replicas?view=rest-resource-manager-containerapps-2025-07-01)
- [Azure CLI REST authentication and syntax](https://learn.microsoft.com/en-us/cli/azure/reference-index?view=azure-cli-latest#az-rest)

References verified against Microsoft Learn on 2026-10-20. Real target API
availability, Azure CLI installation, authentication and permissions still
require private runtime qualification; offline tests cannot establish them.
The adapter does not independently control Azure CLI HTTP redirects; qualify
the installed CLI's transport behavior before treating it as an independent
controller. It only supplies fixed ARM URLs and validates collection continuations.
