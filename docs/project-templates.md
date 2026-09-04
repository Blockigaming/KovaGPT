# Versioned Project templates

KovaGPT's Project-template backend stores a small, explicit Project configuration snapshot. It
does not copy chats, files, memories, members, invitations, credentials, or connected-account
data. Each published version is immutable, so a copy of version 1 cannot silently change after
version 2 is published.

## Authorization model

- Owners can create templates, publish versions, grant access, revoke access, and archive.
- A grant always permits viewing while active. `can_copy` separately controls whether the
  recipient may create a Project from a version.
- Recipients cannot modify a template, its versions, or its grants.
- Archiving revokes every active grant but preserves versions and audit history.
- Sharing uses an authenticated user UUID. Email lookup and invitation UX are deliberately not
  part of this backend and must not disclose whether an arbitrary email has an account.

Browser database roles have authorized `SELECT` only. The authenticated server route performs
all mutations through service-role-only, `SECURITY INVOKER` functions with an empty search path.
The route rejects cross-site writes, non-JSON input, oversized bodies, invalid fields, and failed
distributed rate-limit checks.

## Copy and retry semantics

Every mutation carries a UUID. A matching retry returns the original result; reusing that UUID
with different input is rejected. Publishing, sharing, revocation, and archive use exact expected
revisions so concurrent owners cannot overwrite one another. Copying takes a per-user transaction
lock and enforces the existing Free/Plus/Pro active-Project cap before inserting the Project.

Audit records contain identifiers, version numbers, permissions, and results only. They never
contain template snapshots, descriptions, or system instructions. Mutation receipts are retained
for at least seven days and require a production scheduler to call the bounded purge function.

## Production activation checklist

1. Apply `20260903220000_project_templates.sql` through the normal migration release gate.
2. Confirm the migration manifest and schema contract match the deployed database.
3. Configure a service scheduler to purge receipts older than seven days in batches of at most
   5,000; never expose the purge function to browser roles.
4. With two disposable verified accounts, create version 1, grant view-only access, confirm copy
   is denied, enable copying, copy version 1, publish version 2, and confirm the existing Project
   remains unchanged.
5. Revoke the grant and confirm the recipient can no longer read or copy the template.
6. Reach the Free Project cap and confirm template copying fails without creating a fourth active
   Project.
7. Request both users' account exports and verify owner/recipient grant coverage without foreign
   template snapshots or mutation receipts.

Until that migration and two-user flow are verified in production, this capability is
source-complete only.
