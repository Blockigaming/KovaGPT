# Core content coverage reconciliation: rows 6–19

Date: 2026-10-17. Method: read-only source and existing evidence inspection; this pass changes this document only. No browser, screenshots, test execution, live provider calls or visual approval. Row numbers below follow the supplied subject order: four Library rows (6–9), three Images rows (10–12), four Projects rows (13–16), three Scheduled Tasks rows (17–19). These are coverage findings, not a 14/14 acceptance claim.

## 6. Library home, grid/list, empty and populated states

- Source: `src/routes/library.tsx`, `/library`. Real grid/list toggle, search, type/sort/favorites filters, selection/bulk actions, loading/error/empty states and populated items. Signed-out saved items and signed-in owner-scoped reads are distinct.
- Reusable evidence: `tests/e2e/projects-library-workspaces.spec.ts`; `tests/e2e/core-app-review.spec.ts`; `tests/unit/recovery-library-project-images.test.mjs`. The review kit has populated/empty/error Library variants.
- Limitation: current source and fixture presence do not establish fresh rendered acceptance across all viewports/themes. No independent missing home-screen control identified in this pass.

## 7. Folder and collection organization

- Source: `LibraryFolderOrganizer.tsx`, `src/lib/library-folders.ts`, mounted by the Library route. Create/rename/delete nested folders, scope selection, move selected durable items, refresh, busy/error handling and deletion confirmation exist. Depth and bulk-item limits are explicit. Favorites, type filters and saved-content sources provide additional organization; they are not additional arbitrary editable collections.
- Reusable evidence: `tests/unit/library-folders-policy.test.mjs`, `library-folders-migration.test.mjs`.
- Gap in independent review coverage: `core-app-fixture.ts` returns an empty folders list and `recovery-crud-fixture.ts` covers item deletion rather than folder mutations. A stateful nested-folder/move/rename/cancel/error fixture remains useful. Existing APIs must not be treated as verified live persistence.

## 8. File detail, metadata, download and versions

- Source: Library item rows/cards expose title, type, dates and file-size metadata. The preview dialog shows image or complete saved text. `LibraryVersionsDialog.tsx` supports version listings, reading/downloading versions, text revision saves and replacement original documents. Original document replacement accepts PDF/DOCX/XLSX/PPTX with stated size limits; download delivery uses owner-bound client contracts.
- Reusable evidence: `tests/e2e/library-version-history.spec.ts`; `tests/unit/library-original-runtime.test.mjs`, `library-original-export.test.mjs`, `library-versions-runtime.test.mjs`, `recovery-project-async.test.mjs`.
- Scope distinction: this is a metadata/preview dialog, not a general document-rendering or generic file-rename editor. Raw original PDF/Office page rendering is not present in the Library preview. Record as a product gap only if that richer rendering was part of the required file-detail contract.
- Acceptance remaining: populated versions, long metadata and replacement/download success/error states require fresh rendered review when allowed.

## 9. Saved content, images and attachments

- Source: Library aggregates durable saved items and supported local chat/work/workspace records. Private images load through `LibraryImageMedia` and signing helpers. Chat reuse, Work handoff and Context Pack actions exist. `use-library-attachment-auto-save.ts` and `library-attachment-auto-save.mjs` cover attachment saving; Images has explicit save-to-Library.
- Reusable evidence: `tests/unit/library-attachment-auto-save.test.mjs`, `image-library-pipeline.test.mjs`, `library-image-loading.test.mjs`, `image-principal-client.test.mjs`.
- Review gap: the new recovery CRUD fixture does not simulate image generation/history save or attachment publication. It demonstrates Library preview/deletion, not every saved-content origin. There is no generic create/rename Library-item form; folder create/rename and version replacement must not be mislabeled as item CRUD.

## 10. Images home and generation options

- Source: `/images`, `src/routes/images.tsx`. Prompt composer, preset/style cards, aspect-ratio selection, signed-in/sign-in states and image history exist. Prompt remains editable; failed submission preserves it. A successful earlier request does not clear a newer draft.
- Reusable evidence: `tests/unit/recovery-library-project-images.test.mjs`, `image-history-load.test.mjs`, `image-contract.test.mjs`; Images segment of `core-app-review.spec.ts`.
- Limits: local review correctly reports unavailable service rather than claiming generation. No missing basic home/options control identified; availability is not success-state coverage.

## 11. Generation progress, results and errors

- Source: Images route has indeterminate generation progress, generated-result panel, history, lightbox and explicit unavailable/general failure states. Loading prevents duplicate submission. There is no fabricated percentage-progress indicator.
- Reusable evidence: `tests/unit/image-route-runtime.test.mjs`, `image-provider-hardening.test.mjs`, `recovery-library-project-images.test.mjs`, `recovery-linked-async.test.mjs`.
- Independent review gap: the core fixture supplies unavailability, not delayed-success/result/history variants. Loading, success and result controls therefore need isolated synthetic state coverage, without enabling a real provider. No live generation claim is justified.

## 12. Image editing, variations, download and save

- Source: `ImageEditControls.tsx` uses an explicit availability check, selectable Library original and optional existing PNG mask; it preserves the original and submits an edit operation. Images results/history provide regenerate, reuse prompt, copy, download and save-to-Library actions.
- Actual scope gaps: no dedicated image-variation mode was found; Regenerate submits the prompt again. No in-app drawing/cropping/mask-painting canvas exists; masks must already be PNG Library assets. These should be marked partial if the owner's editor/variation requirement meant a visual editor or source-image variation workflow, rather than the existing text-directed edit.
- Restrictions: editing remains capability-gated, and save/download depend on a real or isolated synthetic result. Do not turn those gates on just for review. Fixture states for original/mask selection, edit success/error, download and save remain needed.

## 13. Projects directory

- Source: `/projects`, `src/routes/projects.tsx`. Search, scope/archive filters, sorting, grid/list layouts, empty/error states, invitations, pin/archive/duplicate controls and project navigation exist.
- Reusable evidence: `tests/e2e/projects-library-workspaces.spec.ts`, `core-app-review.spec.ts`, `recovery-crud.spec.ts`; core and recovery fixture projects.
- Gap: populated directory/source coverage is stronger than complete isolated pinned/archived/invited/error coverage. No new missing directory surface identified.

## 14. Project creation and editing

- Source: New project dialog, name/description, suggestions and rename dialog. Settings edits name/description/custom instructions. Failure paths retain drafts; cancellation is available. Generation/template suggestions are separately service-dependent.
- Reusable evidence: `tests/e2e/recovery-crud.spec.ts` and `recovery-crud-fixture.ts` implement synthetic create/rename/delete success, failure/retry and cancellation. `tests/unit/recovery-project-async.test.mjs` covers settings draft preservation and blank-name guards.
- Limits: fixture test source exists but browser execution was blocked earlier and is now prohibited. Do not label these interactions browser-passed. No additional independent form gap found.

## 15. Project workspace, files and instructions

- Source: `/projects/$projectId`, `src/routes/projects.$projectId.tsx`. Overview, chats, files/images, instructions, collaborative notes, tasks, memory, members, collaboration and settings tabs exist. Files have upload/download/removal and state handling. Instructions autosave serializes requests, retains newer drafts and exposes guarded retry.
- Reusable evidence: `tests/unit/recovery-project-async.test.mjs`, `project-files-policy.test.mjs`, `project-file-storage-policy.test.mjs`, `project-canvas-collaboration.test.mjs`; project workspace cases in `core-app-review.spec.ts`.
- Review gap: current synthetic core project has no populated files/tasks/activity; mutable file upload/download and populated workspace sections are not covered by the new Project directory CRUD fixture. Persistence, collaboration and provider work stay distinct from UI acceptance.

## 16. Project settings, sharing and members

- Source: owner/editor/viewer role gates; invitation, revoke/remove/change-role controls; pending invites; collaborator UI; settings and destructive confirmation. Owner checks and stored-file cleanup contracts exist separately from presentation. Settings save/delete completions are guarded against account/project changes.
- Reusable evidence: `tests/unit/project-invite-security.test.mjs`, `project-owner-membership-integrity.test.mjs`, `project-deletion-policy.test.mjs`, `recovery-project-async.test.mjs`.
- Review gap: core fixture has one owner and no pending invitations; it cannot establish multi-member/share/invitation acceptance. Planned fixture data must never invite a real person. Source availability does not prove a standalone public-project sharing feature, which was not identified here.

## 17. Scheduled Tasks list

- Source: `/scheduled-tasks`, `src/routes/scheduled-tasks.tsx`. Signed-out/free/paid/error states; execution-unavailable banner; search and active/paused/history/failed filters; refresh; task rows with schedule/timezone and settings/history actions. Existing task controls remain visible under supported restrictions.
- Reusable evidence: `tests/e2e/core-app-review.spec.ts`, `connectors-tasks-settings.spec.ts`; `tests/unit/scheduled-tasks-foundation.test.mjs`, `recovery-linked-async.test.mjs`.
- Review gap: core fixture reports `executionAvailable:false` and empty task reads. Thus it covers honest unavailability, not populated list/history/failure variants. Earlier recorded static assertion mismatch in `review-findings.test.mjs` is documented in `2026-10-17.md`, not silently counted as passing.

## 18. Task creation/editing, recurrence, timezone and delivery

- Source: route create form plus `AutomationBuilder.tsx` and `ScheduledTaskEditor.tsx`; title/prompt, scheduled/event modes, local time, IANA timezone, none/daily/weekly/monthly recurrence, DST explanation, saved context, resource/connection grants and explicit schedule/save-paused acknowledgment. Existing editor save can preserve paused state when execution is unavailable.
- Restriction: production create/builder controls are intentionally hidden unless execution is available and plan is eligible. Do not bypass readiness or promise delivery. This is a correct safety restriction, but leaves independent draft-interface review incomplete.
- Actual gap: no user-selectable delivery channel/destination control was found in the editor. It exposes run notification delivery status, which is not delivery configuration. Mark the delivery portion incomplete if required by this row.
- Reusable evidence: `tests/e2e/scheduled-task-editor.spec.ts` has an isolated component harness with execution-capable synthetic data, failure/draft and account-switch cases; `tests/unit/scheduled-task-connected.test.mjs`, `scheduled-task-retry.test.mjs`. Harness existence is reusable evidence, not a newly executed browser pass. Portable review does not currently expose this complete editor via its unavailable core state.

## 19. Task detail, run history, failure, pause/resume and deletion

- Source: Settings/history opens `ScheduledTaskEditor`; run records display status, scheduled time, summary, delivery status, failure type/retry eligibility and earlier-run paging. Row pause/resume/delete controls serialize mutations; resume is gated by eligibility/readiness, and delete uses browser-native confirmation. A retry-eligibility label is not an explicit run-retry action.
- Reusable evidence: `tests/unit/scheduled-task-retry.test.mjs`, `scheduled-task-connected.test.mjs`, `recovery-linked-async.test.mjs`; editor harness noted above.
- Independent UI gaps: populated successful/failed/delivery-failed run histories and mutation retries need review fixture coverage. Native `window.confirm` deletion does not provide an app-styled rounded confirmation; whether to replace it is a separate UI decision, not proof of absent deletion behavior. No explicit run-retry control identified.

## Reconciliation summary

Implemented source surfaces should remain distinguished from reachable isolated review states, live-service readiness, and fresh rendered acceptance. The clearest independent gaps are delivery configuration; a richer image editor/source-image variation flow if required; and missing populated/mutable fixture states for folders, versions/attachments, image results/editing, project members/files, and task creation/history. No deployment, execution-gate, account-permission or provider change is justified by this coverage document.

## Follow-up: required Library item rename contract

The owner specifically requires local-draft rename/move/delete interactions. Item rename is therefore a real gap, not merely a possible richer-preview feature. Contract inspection found `src/routes/api/library/items.ts` only handles list/read, `replace_text` (text plus owner-bound generation/revision) and `delete_text`; all other operations return `Unsupported Library operation.` `src/lib/library.functions.ts` exposes new-item `saveToLibrary` and `deleteLibraryItem`, with no update-title function. Existing folder rename does not cover item rename. No unsupported endpoint or production rename UI was added. An isolated review-only rename draft or a separately approved API contract is needed.
