# Work host on demand and smaller capacity

## Status

Source implementation only. No power permissions, VM resize, host installation,
app settings, cron settings, live image, or production traffic changed by this
branch. Existing main-site gateway scaling stays as configured. The 4 GiB
`Standard_B2als_v2` is a test candidate, not a qualified production minimum.

On November 7, Azure Cost Analysis showed $20.71 month-to-date and a $39.73
forecast. VM compute was $10.97; Container Apps $6.62; registry $1.62. The Work
VM was running as `Standard_D2as_v4` (2 vCPU / 8 GiB). Four recent full days
each showed $2.30 VM compute, about $69 for 30 identical days before disk/IP.
These are observed historical charges, not a promised future bill.

## Behavior

- Normal chat uses hosted inference and does not wake this VM.
- A verified eligible account explicitly connecting to Work requests an ARM start
  through the existing app identity. The UI waits for signed runner readiness;
  Azure's running state alone never enables tools or creates an AI job.
- Authenticated Work operations renew a 15-minute host idle clock. Readiness
  polling and health probes do not. Active attempts, handlers, browser sessions,
  browser cleanup, pending queue work, and an unknown backend check block sleep.
- Shutdown fences admission before checking the backend, then calls deallocate,
  not guest shutdown. Disks and public IP costs continue while deallocated.
- The existing authenticated scheduled-execution heartbeat checks durable Work
  state independently of scheduled AI tasks. It wakes queued/running or unresolved
  work if admission raced deallocation. This bounds recovery by the actual
  scheduler interval plus Azure startup/readiness time; it is not instantaneous.
- Lost ARM deallocation acknowledgements retain the admission fence. If the VM
  remains running, an operator must reconcile the operation before reopening
  admission. This protects new work from being killed by a late shutdown.
- Account deletion that finds a sleeping runner requests wake and retains the
  existing deletion fence/retry flow. It never treats wake as an erasure receipt.

## Exact permission proposal

`infra/azure/work-runner/power-access-plan.json` lists the two existing identities,
the single VM assignment scope, and exact actions. Principal IDs were read from
the authenticated Azure portal. Roles are defined with the production resource
group as their assignable scope but must be **assigned only on the named VM**.
No write/resize, delete, secrets, networking, or role-management actions are
included. No role has been created or assigned by this branch.

## Deployment and acceptance order

1. Finish source review and CI. Reconcile any concurrent production release.
   Record current app image/revision/traffic, runner build, VM size, service
   enablement, and rollback source. Do not redeploy the original host template
   against an existing VM merely to change its size or power settings.
2. After the required at-action approval, install the two scoped custom roles
   and verify their effective permissions. Verify the app selects the existing
   `id-kovagpt-prod` identity (`AZURE_CLIENT_ID=83736eec-abe1-4748-beaa-8e46a271c547`).
3. Install the qualified application and runner source with power disabled.
   The signed runner build must match the application's configured runner build.
   Preserve credentials, TLS, immutable browser/Python images, private attempt
   state, isolation, and the prior production revision.
4. Verify boot-start behavior, including network readiness and the root secret
   initializer. Confirm `kova-work.service`, Docker and Caddy start after a real
   deallocation/start cycle, and native isolation/backend probes become ready.
   The current secret initializer uses ephemeral `/run` state, so a successful
   in-process restart is insufficient evidence for this step.
5. Set `KOVA_WORK_HOST_VM_RESOURCE_ID` to the plan's exact VM resource ID and
   `KOVA_WORK_HOST_POWER_ENABLED=true` in the app and the root-owned host manifest's
   environment. The existing secret loader accepts these `KOVA_WORK_` keys.
   Publish atomically, refresh its environment, and restart only during an idle
   coordinated window. Keep every existing environment value and secret reference.
6. Verify the existing `kovagpt-scheduled-execution` job actually calls the
   authenticated application route every minute and its new `workHost` result
   succeeds. Do not enable idle deallocation unless this recovery path works.
7. Using a verified paid account: cold connect, Work submit, browser navigation,
   long active browser session, takeover, output download, cancel, resume,
   idle expiry, asleep account-deletion retry, and admitted-while-stopping recovery.
   Confirm app readiness/history reads do not repeatedly start the VM. Observe
   actual deallocated state and then a second successful cold start.
8. Only then test the cheaper 4 GiB candidate in an idle maintenance window.
   Verify eastus SKU availability, Trusted Launch, x64 compatibility, vCPU credit
   behavior, native isolation, worst-case browser/Python memory, concurrent
   sessions, provider latency, queues, and OOM/restart counters. Revert to the
   recorded original size if it fails. Do not qualify the candidate on chat RPS.

## Capacity changes as usage grows

One prompt/second sustained means 86,400 prompts/day; request duration and bursts
determine concurrency. Average user count is not a substitute for queue latency,
CPU, peak resident memory, or simultaneous browser sessions. Keep normal chat
gateway autoscaling separate from the isolated browser host.

The existing daily gateway planner is documented in
`kova-adaptive-capacity-and-browser-idle.md`; its throughput setting is a
placeholder until measured. It is a recommendation engine, not proof of live
automatic resizing. VM vertical resizing restarts the host and must drain all
sessions and tasks first. Runtime identities in this proposal intentionally
cannot resize the VM. Automatic VM size selection and a production benchmark
remain separate work; do not claim either is live from this source change.

## Rollback

Disable the power flag on the host first while it is awake, then on the app.
Start/reconcile the VM through the management plane if needed. Restore the
recorded size only when sessions/jobs are idle. Restore the prior signed app
and runner builds together and verify readiness before routing Work requests.
Keep the original revision, disk, static IP, vaults, and all private state.
