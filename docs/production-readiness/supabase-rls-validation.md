# Supabase staging two-user RLS validation

Use a disposable staging project and two browser-like user sessions. Never inject a service-role key into these checks. The prerequisite guard is:

```bash
node scripts/staging-validation/external-harness.mjs supabase --fixture <sanitized-prerequisites.json>
```

For chats, projects, project files, Library items, research, images, private assistants, connector records, subscriptions, shares, and project memory: User A creates/reads/updates/deletes its fixture where supported; User B must receive an indistinguishable empty/not-found/denied result on read, update, and delete, and must not infer existence. Repeat unknown UUID, malformed ID, deleted resource, expired/logged-out session, identity switch, revoked share, approved-field-only public share, and project-only memory ownership.

Capture only status, table/resource category, actor A/B, operation, expected/actual outcome, and correlation ID. Never capture tokens or private row payloads. Any cross-user result is a critical stop condition: isolate staging, preserve redacted evidence, correct policy/route authorization, rerun static contracts, then rerun the full matrix.

After User A creates disposable fixture rows, copy `supabase-two-user-manifest.example.json`, replace IDs, inject the staging URL, publishable key, and two user JWTs through an authorized shell, then run `supabase-two-user.mjs --manifest <file> --execute`. The tool refuses service-role sessions. Clean up fixtures as User A only after the complete pass.
