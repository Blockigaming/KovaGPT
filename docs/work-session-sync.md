# Planning session sync

Work now includes saved planning sessions with objectives, context, checklists, personal status, an append-only planning history, and branches. Saving a prepared handoff is explicit. Continuing a plan in Chat transfers the user's current plan without creating a background run.

Sessions use the existing owner-scoped Work sync clock, durable local outbox, exact revisions, mutation receipts, quota accounting, tombstones, and account export. Guests retain sessions only on their current device. After signing in, confirmed guest data remains separate. Successful local persistence is required before a mutation can leave the browser. Account changes and data clearing invalidate stale UI actions; another tab or offline state cannot silently substitute a different bearer identity.

Each acknowledged event is immutable. Keeping a device plan during a conflict merges the account history before appending the local events and an explicit conflict choice. If the history is full or a branch parent changed, the user can save the current plan as a new independent session; this starts a new history and keeps the account copy. No old event can be rewritten through that choice.

Branching requires an acknowledged parent revision. Creation verifies current owner, live parent, root identity, and exact parent revision inside the shared Work clock transaction. The branch gets its own stable record ID and an immutable parent reference. Repeated submission of the same mutation returns the same receipt. Deleting a parent may make the parent unavailable for inspection; existing child plans remain usable. Deleted sessions are scrubbed and cannot be resurrected with invented history.

The planning UI does not start jobs or interpret personal checklist/status changes as model activity. Event times are reported by the user's device and are not execution evidence. An execution control plane must use separate server-authored runs and authorization checks against the session revision.

Source verification covers actual PostgreSQL functions and owner RLS, mutation privileges, stale revisions, concurrent parent changes, immutable history, repeat receipts, tombstones, offline client acknowledgment, and conflict recovery. Hosted browser/isolated database validation and production migration/deployment remain separate release gates.
