# Two-user RLS isolation plan

## Protected matrix

`release-rls-matrix.json` inventories direct-user, project-membership, and shared-resource tables that require cross-user verification. Each table must prove:

- owner/member can read the permitted row;
- unrelated authenticated user cannot read it;
- unrelated authenticated user cannot update it;
- unrelated authenticated user cannot delete it;
- anonymous requests cannot access protected data;
- service role can perform only approved administrative behavior;
- internal SECURITY DEFINER functions are not directly executable by browser roles unless explicitly intended.

## Safety controls

`npm run release:rls:two-user:dry` validates the matrix against `database-contract.json` without network access or data mutation.

Execution is intentionally blocked until every matrix entry has an explicit minimal fixture. When fixtures are complete, `npm run release:rls:two-user`:

1. requires an explicit isolated project ref and URL;
2. refuses to execute when that ref equals the production ref;
3. creates two temporary confirmed users with a unique rehearsal marker;
4. signs both users in through the public Auth path;
5. inserts fixture rows with the service role;
6. runs cross-user read/update/delete checks through the Data API;
7. removes fixture rows and temporary users in `finally` cleanup;
8. emits a machine-readable PASS result.

## Fixture completion

Fixtures must be filled only after the complete schema exists in the isolated rehearsal target, because required columns and project-membership dependencies differ by table. Do not invent fixture shapes from source assumptions.

After execution, also run Supabase security advisors and capture policy definitions, grants, function security modes, and Storage policies as evidence.
