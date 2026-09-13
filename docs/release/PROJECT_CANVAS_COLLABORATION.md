# Project and Canvas collaboration source

This package implements collaboration in repository source. It does not prove that the migration or realtime publication is active in production. No live migration, provider, infrastructure, identity, or deployment change was performed.

## Audience and permissions

- Personal Canvas documents belong to one authenticated user. Existing accepted personal edits and up to 49 earlier versions are imported only for that same owner.
- A Project-origin Canvas is visibly labeled “Project members” and requires an existing message in that Project’s chat. Owners and editors may create/edit/comment; viewers may read an existing document. Opening a personal message inside another context never widens its audience, copies its private history, or shares private comments. No personal-to-Project conversion is implemented.
- SQL rechecks current membership and the caller’s account deletion fence. Browser requests pin the verified account token. Switching account/resource or closing Canvas disposes its editing session; delayed history, save, comment, and presence responses cannot enter a new session.
- Authenticated roles have SELECT only on Canvas and presence tables, and no direct INSERT/UPDATE/DELETE on Project notes/comments. The public RPC is an invoker wrapper around a private, fixed-search-path mutation gateway. No service key enters browser code.

## Revision and comment behavior

Canvas and Project notes save with an expected revision under database locks. Concurrent stale edits produce a conflict and preserve the local draft. The user may copy it and explicitly load the current version. An exact retry after a lost acknowledgement is idempotent. Legacy note callers must now supply `expectedRevision`; older writes to personal message history invalidate the canonical Canvas revision.

Personal Canvas edits mirror into the existing personal message history under its canonical advisory lock. The history table accepts complete Canvas documents up to 200,000 characters, including empty content, while existing legacy RPC input limits remain intact. Project documents never write to personal history. Canvas retains at most 50 revisions; prior content is fetched on restore/compare, rather than in every live refresh.

Canvas comments are durable and bound to their author, document and revision. Selected text anchors use Unicode code-point positions plus the original quote and nearby context. The UI follows a uniquely located moved selection and explicitly labels changed, deleted or ambiguous selections. Deleted comment content is redacted; identifier tombstones prevent delayed retry resurrection. Up to 500 comment identifiers are retained per Canvas, paginated 100 at a time. Explicitly loaded older pages survive live refreshes. Project comments retain their existing section anchors, mentions and activity entries; they show the latest 100 in deterministic order.

## Presence and reconnect behavior

Authorized INSERT/UPDATE Postgres Changes notifications trigger debounced canonical reads; payloads never become trusted content or identity claims. DELETE events are not subscribed. No objects are created in the locked `realtime` schema. The migration adds relevant public tables to `supabase_realtime` only if that publication exists.

Server-authored presence expires after 45 seconds, refreshes every 15 seconds, and has at most eight active sessions and 64 retained session records per user. Closed session tombstones reject late heartbeats. Presence carries actor UUIDs and counts, never names or email addresses. Peer counts exclude revoked Project members. Account/resource cleanup unsubscribes, aborts requests and leaves best-effort; expiration handles disconnected browsers. Presence quota failures do not block fresh authorized reads. Reconnecting and unavailable states keep local drafts visible without claiming that they were saved.

## Export integration

The aggregate account-export change must include canonical data:

- `canvas_documents`: `id`, `private_owner_id`, `project_id`, `created_by`, `chat_id`, `message_id`, `content`, `revision`, `updated_at`. Audience is exclusively private owner **or** Project. Project rows survive creator deletion through `created_by ON DELETE SET NULL`; their Project owns their lifecycle.
- `canvas_revisions`: `document_id`, `revision`, `content`, `created_at`, limited to the authorized document IDs.
- `canvas_comments`: `id`, `document_id`, `author_id`, `body`, `anchor`, `created_at`, `deleted_at`, limited to the authorized document IDs and the exporter’s applicable author/access policy. Deleted rows contain only the redacted marker and no anchor.
- `collaboration_presence` is ephemeral and must be omitted.

Private document deletion cascades from its Auth owner; Project document deletion cascades from its Project. Revisions/comments cascade from the document; comment author deletion cascades that author’s comments.

## Verification and activation

Executable PGlite tests exercise owner/editor/viewer/outsider access, account fences, private-history separation, stale revision rejection, idempotent retries, long/empty complete documents, comment anchoring and redaction, bounded server-owned presence and closed sessions. Client tests exercise pinned tokens, account changes, bounded responses, reconnect/coalescing, late responses, Unicode anchors and older comment retention. Source regressions retain Canvas autosave, retry, history and graceful degradation checks.

The aggregate release must regenerate migration/schema/route manifests and pass its complete database upgrade and browser CI. Owner-controlled activation remains: approved migration/deployment, actual publication verification, and a two-account browser acceptance test for edits, revocation, disconnect/reconnect and conflicts. That operational proof must be recorded before claiming live collaboration availability.
