# Workflow skills

Workflow skills are reusable, owner-scoped instruction and reference-resource packages. They live
beside connectors in **Apps & plugins**, but they do not create a connector, tool, credential, model,
entitlement, or approval grant.

## Lifecycle

1. A verified user creates a private package. Version 1 is immutable and installed automatically.
2. Editing creates another immutable version. The existing installation remains pinned until the
   user explicitly installs the new version.
3. **Use in chat** transfers only the installation ID, version ID, and display name through a
   principal-scoped, one-use browser handoff.
4. Chat ingress accepts only the two UUIDs. The server resolves them through the current owner and
   requires the requested version to be the version currently pinned by that installation.
5. Resolution is checked again before provider work. An uninstall, version change, account fence,
   ban, deletion, or owner change makes the selection fail closed.

## Bounds

- 100 packages per owner and 30 immutable versions per package;
- 12,000 instruction characters;
- up to 10 resources, each with a 120-character title and 8,000-character body;
- 32,000 UTF-8 bytes across the normalized text fields;
- every immutable version is charged atomically against the owner's server-resolved storage plan;
- 100 packages returned by one management read;
- replay-safe mutations retained for a bounded eight-day window.

## Authority boundary

The resolver adds package content to the server-built system message for text chat and to the
provider prompt for image generation as user-selected workflow guidance. It does not touch model
selection, plan checks, tool construction, connector grants,
provider credentials, approval gates, or accounting. The injected boundary explicitly says that
package text cannot authorize those capabilities. Resource bodies are labeled as untrusted data so
instructions embedded inside a reference do not become authority.

Packages, versions, installations, and replay receipts cascade on account deletion and are included
in the account export. Browser roles cannot select package tables directly; authenticated mutations
use owner-bound security-definer functions, while runtime resolution is service-role only. Explicit
package deletion releases the bytes charged for all of its immutable versions.

## Release boundary

The migration is source-only until an approved database rollout. A green source tree does not prove
that the production schema has these tables or that a real provider run used a selected skill.
