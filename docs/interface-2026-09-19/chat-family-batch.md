# Chat family implementation batch — 2026-09-24

Base: `6db7cd15aa68319ea5453b79dc8b08dfda49fd31` in `Blockigaming/KovaGPT`.
Branch: `interface/chat-family-20260924`.

## Delivered source

| Journey | Implementation |
| --- | --- |
| New chat → saved URL | `/` and `/c/:conversationId` share one mounted workspace; navigation waits for an acknowledged history write and readback. |
| Sidebar → saved conversation | Shared app sidebar writes and verifies history before navigation; late selections are discarded after account changes or leaving the page. |
| Browser route → chat | Route changes select the matching chat; unavailable chats show an explicit state. Publishing the current chat URL preserves queued attachments. |
| Canvas → full page | `/c/:conversationId/canvas/:documentId` opens the exact private document and checks its owner and chat. It reuses editing, versions, comments, and export. The page never creates a replacement document. |
| Library → shared snapshot | `/share/:shareId` requests a recipient-visible, non-revoked snapshot through the authenticated client and renders a read-only page with sign-in, retry, and unavailable states. |

Guest history retains the existing session-only policy: a refresh clears it. Saved-chat URLs do not change that policy. Project Canvas and shared resource types other than chat snapshots are outside this batch.

## Checks

- TypeScript typecheck passed.
- Node preview build and the strict source/build audit passed.
- 56 existing focused checks passed across chat storage, history actions, temporary chat, Canvas autosave/adoption, collaboration client, local database access rules, and shared snapshots.
- Six new executable checks passed for acknowledged persistence/readback, temporary-chat exclusion, failed/stale writes, exact-document loading, late-response rejection, and preserving attachments when publishing a URL.
- Register check passed: 634 retained records, 629 provisional active targets.
- One new test initially failed because its VM used a different `Error` constructor; the harness was corrected and all six new tests passed.

## Acceptance and access

No page is newly accepted. Overall UI/UX and entire interface completion remains **0.00% accepted — 0/629 provisional pages and 0/28 complete families**.

Cloud-browser connection was rejected by automatic approval review because it was considered a restart of the previously blocked preview. No browser screenshots, mobile/desktop visual acceptance, or live recipient/account verification are claimed. Unit tests and a build do not substitute for those checks.

No remote push, merge, deployment, production operation, or live database mutation was performed. The earlier separate-approval rule for pushing still applies. This batch can be reviewed as one commit/patch and should stay together during review.

## Remaining acceptance work for this batch

1. Verify signed-in new chat → saved URL → reload, sidebar selection, browser back/forward, archive/delete/restore, and streaming across chat route changes.
2. Verify Canvas edits, revisions, comments, exports, unauthorized document IDs, and returning to chat with real authorized accounts.
3. Verify recipient snapshot access and revocation with distinct owner/recipient accounts.
4. Inspect the connected journey at 390×844 and 1440×900 against the assigned source references; fix findings before crediting acceptance.

Continue implementation in coherent batches. A blocked visual review does not block unrelated source work.
