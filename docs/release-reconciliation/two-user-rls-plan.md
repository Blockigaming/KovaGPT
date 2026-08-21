# Two-user RLS isolation plan

## Protected matrix

`release-rls-matrix.json` now contains executable fixtures for 14 high-value tables across direct-user, project-membership, shared-resource, and server-managed data:

- projects, project chats, project files, and project memory;
- Library items, preferences, and chat memory;
- shared chats;
- connected accounts and financial accounts;
- subscriptions;
- scheduled tasks;
- user storage;
- writing documents.

Each table must prove:

- owner/member can read the permitted row;
- unrelated authenticated user cannot read it;
- unrelated authenticated user cannot update it;
- unrelated authenticated user cannot delete it;
- anonymous requests cannot access protected data;
- service role can insert, verify, and clean approved administrative fixtures;
- a denied update/delete leaves the original row intact.

## Safety controls

`npm run release:rls:two-user:dry` validates all fixture shapes against `database-contract.json` without network access or data mutation. The committed matrix is execution-ready only when `protectedTableCount` and `fixtureCount` both equal 14.

`npm run release:rls:two-user`:

1. requires an explicit isolated project ref and URL;
2. refuses to execute when that ref equals the production ref;
3. creates two temporary confirmed users with a unique rehearsal marker;
4. signs both users in through the public Auth path;
5. inserts fixtures with the service role, resolving `$USER_A`, `$EMAIL_A`, `$MARKER`, and dependent bindings such as `$PROJECT_A`;
6. verifies owner read, anonymous denial, unrelated-user read/update/delete denial, and post-denial row survival;
7. removes fixture rows in reverse dependency order and deletes both temporary users in `finally` cleanup;
8. emits a machine-readable PASS result without printing credentials.

## Rehearsal procedure

Run the matrix only after the complete 72-migration chain succeeds in an isolated Supabase branch/project. Capture:

- branch/project ref and expiry;
- exact source SHA and migration manifest checksum;
- fresh-database and realistic-upgrade results;
- two-user matrix result;
- Supabase security/performance advisors;
- policy, grant, trigger, and SECURITY DEFINER inventories;
- cleanup counts proving no rehearsal users or rows remain.

The current production target must never be used for this rehearsal. Production RLS verification happens only after the isolated result passes and the reviewed migration set is explicitly approved.
