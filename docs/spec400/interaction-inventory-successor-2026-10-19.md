# Successor interaction/control reconciliation

Reconciled 2026-10-19T03:15:04.020771+00:00. Baseline `cf083bbc791c1fd1e738def44970262413d6d9e6`; final application `1b583398f352ff2d347d414ced1b6270bf33ae31`; adapter/source `972311cb3c848adcc57794699708cd20b9b25848`. Application source is identical between those last two commits.

Read-only source review and documentation only. No application code changed and no tests, build, browser, network or service operations were run for this reconciliation.

## What changed in the inventory

- Preserved the original 230 record IDs and exact evidence attribution. Mapped 49 successor control-contract refinements to 52 original IDs, including seven final-source refinements. These overlap existing records; they are not additional screens or completion points.
- Preserved 75 review configurations, 8 families and 19 shared primary behavior branches; retained 12 public-template groups, 132 source-route entries and 84 supplemental rows (81 included, 3 Careers exclusions).
- Account production unavailable controls are separate from synthetic 30-day scheduling/recovery. Searchable consumers, comment confirmations, Library/Project recovery and dirty inspectors, and pinned inspection now have explicit event/result/error/scope/service records.
- Four additional corrections retain their finite ADD-01–04 identifiers and actual e1/d21 receipts. The d21 adapter package used the unchanged e1 compiled app.
- Final source adds explicit Send next/request-status/retry gates, Project-create recovery and chat-copy validation, archived-chat Trash recovery, and the project-chat deletion boundary. All seven new refinements remain source-only pending the current native pass.
- Whole 400 flags and acceptance.json are untouched. Items 15/398 remain partial until the exact finished build has a bounded visible-control reconciliation.

## Evidence rules

- Source-only: current source and anchors read; no new rendered claim. Changed source cannot inherit an old receipt as a fresh pass.
- Rendered earlier, unchanged: listed implementation files compare byte-identical to the cited application commit; only that receipt’s stated observation is inherited. Shared style/dependency changes and all unobserved branches remain unverified.
- Unverified: no applicable runtime or live-operation proof. Hash equality by itself does not prove behavior.
- Every control in the JSON has exact current path/anchor/line/SHA-256 plus event, result, error, persistence/account scope and service boundary. Baseline records retain their original committed source IDs.

## Concrete successor control map

| Successor contract                  | Original inventory IDs                                                                                                                           | Current control/result                                                                                                                     | Evidence                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| account.deletion.production         | settings.delete_account                                                                                                                          | Delete account; Close; disabled Scheduling unavailable                                                                                     | source only                |
| account.deletion.confirm_review     | settings.delete_account                                                                                                                          | Cancel; Schedule deletion; schedule-failed retry                                                                                           | rendered earlier unchanged |
| account.deletion.recover_review     | settings.delete_account                                                                                                                          | Recover account; Close; Done; optional Check status                                                                                        | rendered earlier unchanged |
| picker.shared_threshold             | settings.navigation, response.branch, task.context, task.approve_reads, task.event_source, work.preparation, library.folders, projects.templates | Search input; labeled options; selected check; no matches; Escape                                                                          | rendered earlier unchanged |
| picker.settings_sections            | settings.navigation                                                                                                                              | Section; Search sections; Settings search; no match; section option                                                                        | source only                |
| picker.chat_branches                | response.branch                                                                                                                                  | Branch trigger; Search branches; branch options; Retry                                                                                     | source only                |
| picker.work_projects_executions     | work.preparation                                                                                                                                 | Project; Search projects; execution selector; Search executions                                                                            | source only                |
| picker.work_specialists             | work.preparation                                                                                                                                 | Search specialists; specialist selection                                                                                                   | source only                |
| picker.task_files                   | task.context                                                                                                                                     | Files; search; selected option                                                                                                             | source only                |
| picker.task_accounts                | task.approve_reads                                                                                                                               | Connected accounts; search; selected option                                                                                                | source only                |
| picker.task_approvals               | task.event_source                                                                                                                                | Task approvals; search; selected option                                                                                                    | source only                |
| picker.task_resources               | task.event_source                                                                                                                                | Connected sources; search; selected option                                                                                                 | source only                |
| picker.library_folders              | library.folders                                                                                                                                  | Move destination; Search folders; Unfiled; Move                                                                                            | source only                |
| picker.template_versions            | projects.templates                                                                                                                               | Published version; Search published versions                                                                                               | source only                |
| result.comments.session             | result.comments                                                                                                                                  | Comment label/field; Add comment; Delete comment                                                                                           | source only                |
| result.comments.durable             | result.comments                                                                                                                                  | Comment label/field; Add; anchor; Load older comments                                                                                      | source only                |
| result.comments.delete_confirmation | result.comments                                                                                                                                  | Named selected comment; Cancel/Escape; Delete comment; retry after failure                                                                 | rendered earlier unchanged |
| result.action_feedback              | result.save, result.export, result.versions, result.copy                                                                                         | Save; export format; Copy; Preview version; feedback dismiss                                                                               | source only                |
| result.version_inspector            | result.versions                                                                                                                                  | Version history; Preview version; Restore this version; Close history                                                                      | source only                |
| library.folder_recovery             | library.folders                                                                                                                                  | New; Rename; Create/Save; Retry; Delete folder; Cancel                                                                                     | source only                |
| library.bulk_recovery               | library.delete, library.select, library.folders                                                                                                  | Delete selected; per-chat confirmation; Cancel; folder Move                                                                                | source only                |
| library.versions.operations         | library.versions                                                                                                                                 | Read version; Download; replace original chooser; text field; Save new version                                                             | source only                |
| library.versions.dirty_close        | library.versions, library.inspect                                                                                                                | Close/Escape/backdrop; Keep editing; Discard changes                                                                                       | source only                |
| library.upload.retry_identity       | library.upload                                                                                                                                   | Choose document; Upload; Retry same upload; Close                                                                                          | source only                |
| project.instructions.recovery       | project.instructions                                                                                                                             | Instructions field; Save; Retry; Cancel                                                                                                    | source only                |
| project.tasks.recovery              | project.task_add, project.task_status, project.task_order                                                                                        | Add/Enter; Cycle status; Retry loading tasks; Move up/down; drag reorder                                                                   | source only                |
| project.tasks.delete                | project.task_order, project.task_status                                                                                                          | Named Delete task; Cancel/Escape; retry deletion                                                                                           | source only                |
| project.memory.recovery             | project.tabs                                                                                                                                     | Retry loading memories; Add/Enter; Remove; retry removal                                                                                   | source only                |
| project.member_recovery             | project.member_remove, project.invite_revoke, project.member_role                                                                                | Role; Remove; revoke invite; Retry removal/revocation; leave confirmation                                                                  | source only                |
| project.templates.recovery          | projects.templates                                                                                                                               | Refresh/list; save draft; publish; copy/create; archive confirmation; Retry same request                                                   | source only                |
| project.chat.draft_context          | chat.context, chat.message_field                                                                                                                 | Context; project instructions/files/results/conversation sections; normal message field; navigation warning                                | source only                |
| chat.pins.inspect                   | chat.context                                                                                                                                     | Pinned files; Inspect; Refresh context; Retry pinned context/inspection; Close inspection                                                  | source only                |
| chat.pins.unpin_focus               | chat.context                                                                                                                                     | Unpin; Unpin from this chat; Close inspection                                                                                              | source only                |
| chat.pins.library_choices           | chat.context, chat.library_picker                                                                                                                | Choose a Library item to pin; Refresh/Retry Library choices; Pin                                                                           | source only                |
| additional.ADD-01                   | review.shared_directory, review.shared_breadcrumb                                                                                                | Search review pages; Page family; detail card; Review pages breadcrumb                                                                     | rendered earlier unchanged |
| additional.ADD-02                   | review.shared_reset, review.media_reference                                                                                                      | Open local image; Remove reference; Reset draft; Cancel; Reset current draft                                                               | rendered earlier unchanged |
| additional.ADD-03                   | review.shared_preview, review.shared_disclosure                                                                                                  | Preview draft; native Export preview summary; Close preview                                                                                | rendered earlier unchanged |
| additional.ADD-04                   | additional.public_content                                                                                                                        | Search loaded Kovas; Retry directory; Load more Kovas; card; Create/manage link                                                            | rendered earlier unchanged |
| task.validation_discard             | task.fields, task.save, task.close                                                                                                               | Linked field errors; invalid-submit summary; Retry same request; Keep editing; Discard changes                                             | source only                |
| help.support_recovery               | help.support                                                                                                                                     | Email/message fields; Send; validation focus; accepted receipt; uncertain outcome                                                          | source only                |
| chat.upload_allowance               | chat.attach_menu                                                                                                                                 | Observed upload allowance; Retry allowance                                                                                                 | source only                |
| auth.resend_retry_after             | auth.magic, auth.verify                                                                                                                          | Resend magic link/verification; service delay; local fallback countdown                                                                    | source only                |
| chat.send_next                      | chat.send, chat.stop, chat.message_field                                                                                                         | Send next; Cancel next message; Edit next message; Open original chat; held/queued status                                                  | source only                |
| chat.request_status                 | chat.send, chat.stop, response.retry                                                                                                             | Retry-delay countdown; Cancel retry; session-required notice; guarded Sign in                                                              | source only                |
| chat.retry_identity_and_gating      | response.retry, chat.send                                                                                                                        | Retry response; conditional Retry toast; retry-delay Cancel                                                                                | source only                |
| project.create_recovery             | projects.create, projects.retry                                                                                                                  | Name/Description; Create project; persistent error; Dismiss error; Check Projects; deliberate retry checkbox; Retry create project; Cancel | source only                |
| project.chat_copy_validation        | header.project                                                                                                                                   | Project picker; Chat title; blur/submit validation; Add; Open project to check                                                             | source only                |
| settings.archived_trash_recovery    | chat.trash, settings.navigation                                                                                                                  | Delete archived chat; named Move to Trash/Delete permanently confirmation; Cancel; Review delete; Retry delete; Retry archive cleanup      | source only                |
| project.chat_delete_boundary        | project.chat_delete                                                                                                                              | Disabled named Delete; adjacent recoverable-Trash unavailable explanation                                                                  | source only                |

## What prior receipts still establish

- f35: bounded account confirmation/unavailable/scheduled presentation, linked task-error/dirty-discard and matched loading surfaces. No real account scheduling or recovery.
- 1fc: Project Tasks/Memory retry/status/add and named task-delete focus; Library mixed eligible Move, folder-delete focus, Versions presentation/Close. Dirty replacement/read/download services and current selector edits are not part of that receipt.
- e1: Settings selection, Work nine-project selection, review-directory return filters, native media reset/reselection, export-disclosure reopen, persistent Result Save failure.
- d21: assistant directory error→Retry→verified empty on the unchanged e1 app; synthetic shared-comment Add/Cancel/Escape/error/retry with other comments/draft retained.
- ee68: corrected picker row/input geometry and phone comment confirmation/error. b96: final 320 Light comment header alignment and safe Cancel focus only; no deletion was executed in that last header pass.
- The JSON compares listed current implementation files against each applicable original commit; changed paths stay source-only. Existing live-service limits remain.

## Finite independent UI/control remainder

### UI-01: Build-to-visible-control reconciliation for the exact integrated successor.

All source-only successor records below; account recovery, changed Library/Project inspectors and pinned inspection must use actual rendered current controls.

Stopping condition: Exact source identity, visible condition, event/result/error and focus are recorded for the finite affected matrix; leave unavailable branches explicit. Do not reopen unchanged prior receipts or count screenshots as pages.

### UI-02: Searchable selector conditional matrix.

Short branch picker; >7 branches/folders/template versions/task files/accounts/approvals/resources/Work specialists/executions; duplicate names, disabled/no-match, first/last keyboard traversal and return focus.

Stopping condition: Representative shared behavior plus each real conditional consumer is mapped; do not fabricate data to imply live provider approval.

### UI-03: Library read/mutation/dirty inspector recovery.

Partial bulk failure/cancellation, later selection, account/reset interruption, Versions initial/read/download/replace failures, dirty Keep/Discard and exact fallback focus; upload same-request retry.

Stopping condition: Source-only branches independently rendered with isolated existing contracts or left explicitly unverified. No real deletion/download required for this map.

### UI-04: Project instructions/tasks/Memory/member/template and project-chat lifetimes.

Owner/editor/viewer controls; instruction rejection/Cancel; reorder arrows/partial failure; Memory removal; member revoke/removal retry; template uncertain same-request retry; A→B→A chat draft/navigation/context. Project-create uncertainty/check-before-retry, chat-copy title validation and the unavailable recoverable project-chat deletion boundary are newly mapped source-only controls.

Stopping condition: Retain original 990 nested 70-record IDs and 1fc rendered outcomes; verify only changed or unobserved conditions, not live invitation delivery.

### UI-05: Result feedback, version inspector and comment behavior.

Source-only version read/restore/export failures and dirty conflicts; session-only comment add/delete; current durable synthetic retry/focus/stale-document cases.

Stopping condition: Do not repeat b96 header pixels or unchanged named-confirmation proof. Real collaboration and missing version provenance remain separate contracts.

### UI-06: Pinned entries omitted by shared resolver text budget.

Inspection/Unpin exist but omitted names/content cannot be recovered from current resolver; current preview must disclose this.

Stopping condition: Keep unresolved entries explicit. Any complete per-pin inspection beyond current returned items needs separately authorized existing-source/API work; do not claim every pin title is resolved.

### UI-07: Final source-only Chat/Help/Project-create changed-control verification.

Send next snapshot, successful dispatch versus Stop/error/context holds, cancellation/edit/newer draft, retry eligibility/original request identity, visible retry delay/session-required and pending-draft sign-in guard; Project-create persistent uncertainty/check-before-retry and chat-copy linked title validation. Help persistent known/uncertain/accepted feedback is implemented. Help draft-navigation preservation and per-user-turn delivery-state semantics are not supplied by these source changes.

Stopping condition: Verify only final application 1b583398 changed controls against the current native pass. Do not infer durable queue, delivery receipt, remote Stop acknowledgment, idempotent project creation or Help delivery.

### UI-08: Remaining conditional settings/security/plugin controls from baseline G03/G08/G10.

Kova/legacy password/passkey/MFA/family/import branches; task copies/approval revoke; GitHub installation/repository and Google/workflow configuration states not individually re-enumerated here. Settings archived-chat Trash transfer, retention reconfirmation and cleanup-only retry are now mapped explicitly; their current native conditions remain unverified.

Stopping condition: Retain baseline records and exact unverified conditions. Add only reachable concrete controls from actual source; do not reopen service-independent completed groups.

### UI-09: Additional-page finite 19-branch/12-public-template census.

Retain all75 configurations and81 in-scope route rows; existing ADD-01/02/03 and ADD-04 recovery receipts stand. Stable assistant loading, populated/paginated/retained-query error and unobserved local family keyboard/empty/error branches remain unverified.

Stopping condition: Representative shared-behavior coverage with explicit exceptions; no 75-page duplicate screenshot requirement and no new primary-page count.

### UI-10: Previously bounded shell/operational evidence gaps.

Account identity loading, 8-recent+independent-pins history, clipboard failure, mobile toast clearance, large text, long desktop code Copy and real async main-page loading/error cells listed in remaining-native-gate-b96d38e.md.

Stopping condition: Use existing or explicitly isolated fixtures only. Static pages do not need invented service-loading states; full 1440 physical pixels remain unavailable in the documented environment.

## Item 391: main-page state applicability

This matrix reuses sealed list-state evidence and identifies only applicable async gaps. It does not close item 391. Historical receipt identifiers retain their actual application/source version; the d21 directory receipt used the e1 compiled app.

| Surface                     | Existing bounded state evidence                                                          | Concrete remainder / not applicable                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Library                     | Loading 990/f35; fixed error 228; true empty 990; populated 9c/1fc.                      | No new generic four-state fixture. Compact 48px density and changed recovery/dirty inspector conditions are separate.                                                                                        |
| Projects list               | Loading 990/f35; empty/error 228; populated 990.                                         | No new generic list fixture. Detail roles/recovery are separate.                                                                                                                                             |
| Project detail              | f35 task/memory errors; 1fc retry/status/add/delete focus and populated rows.            | Stable whole-detail pending, true-empty/missing/role, changed reorder/chat-draft conditions and unavailable project-chat deletion are unverified.                                                            |
| Scheduled tasks             | Loading 990; empty/error 228; sampled populated row/editor 9c/228.                       | Changed validation/selectors/uncertain saves only. No scheduler execution inferred.                                                                                                                          |
| Main Chat                   | Empty start and populated outputs; 30-message/long-content 990.                          | Stable pending/error, scoped retry/session status, Send next dispatch/hold/edit/cancel, and applicable history/sync reads need current bounded evidence. Inert adapter cases are source-only until rendered. |
| Images                      | Initial surface; sample success 9c/228; failed generation 228/990.                       | Stable generation/edit pending is applicable and uncredited; use inert hold, no provider.                                                                                                                    |
| Plugins                     | Static 13-provider catalog and unavailable details 9c/228.                               | Real auth-loading and Google/GitHub status-read pending/error are applicable. No catalog-network loading/error state exists.                                                                                 |
| Work                        | Prepared controls and unavailable Start 9c/990; project selector e1.                     | Historical list/detail loading/error/verified-empty/sample-detail are separate, applicable reads; unavailable execution is not a successful empty read.                                                      |
| Settings/Profile/Appearance | Local form/default/preview/reset 638; selector ee68.                                     | No generic whole-page empty/loading fiction. Actual identity/manager/Usage/Billing reads remain separate.                                                                                                    |
| Billing/Usage               | Honest plans/unavailable invoices 638; verified fixture counters/Free not-applicable 9c. | Actual subscription/usage read pending/error require scoped fixtures. Missing invoice API is unavailable, not empty.                                                                                         |
| Help                        | Local search/disclosure 9c.                                                              | Authored body has no service-loading state; actual Support pending/rejection/uncertain/accepted needs isolated form fixtures.                                                                                |
| Public/local Review         | Representative families 9c; directory return/media reset/preview e1.                     | No generic async state per authored page. Only actual local control errors/account-context hydration; 19-branch matrix stays finite.                                                                         |
| Assistant directory         | e1 failure; d21 adapter/e1 app Retry→verified empty.                                     | Stable loading and synthetic populated/paginated/retained-card errors remain unverified; do not invent published catalog records.                                                                            |
| Auth/identity               | Synthetic fields/Show-Hide/recovery entry 638 and corrected shell 9c.                    | Stable identity hydration and form pending/error remain applicable; no production authentication was performed.                                                                                              |

Finite async fixture families: Chat; Images pending; Billing/Usage reads; assistant-directory pending/populated pagination; Work historical reads; auth/identity and actual Plugin status reads; current Support form. Existing Library/Projects/Tasks list states are reused, with narrow changed-control exceptions. Static bodies do not multiply this list.

Source anchors and a per-state applicable flag, meaning, exact historical receipt and remaining proof are in the JSON. Whole-item and live-service acceptance remain unverified.

## Unavailable contracts and owner facts

### LIVE-01: unavailable live contract

- Production account 30-day schedule/status/cancel/recover/cleanup lifecycle; legacy irreversible delete is not a substitute.
- Production scheduled-task receipt producer and background execution evidence; local preparation/receipts are not execution.
- Confirmed chat delivery, remote stop acknowledgement, durable background queue and general transport-health semantics.
- Recoverable server project-chat Trash/restore. Disabled project-chat Delete controls are truthful source behavior; browser-local archived-chat Trash cannot satisfy this contract.

### LIVE-02: missing service metadata

- Managed public Result share creation/revocation and public ACL; current shares remain private recipient-scoped snapshots.
- Saved-result source conversation/message backlinks, retrieval timestamp/source kinds, older durable Result version origin where absent.
- Billing invoices/next charge/session device inventory/authoritative recent-work project-last-opened fields where not returned.

### LIVE-03: live validation or authorization gate

- Real provider/OAuth connection, email delivery, invitations, payments/Billing changes, production authentication, collaboration and file lifecycle operations.
- Voice, video/upscale/loop, persistent computer/teach recording, external event automations and other explicitly unavailable review capabilities.
- Real-user p75/model timing and deployed performance; synthetic UI fixtures cannot supply these measurements.

### FACT-01: owner facts and legal approval

- Company/legal identity, offices/dates/leadership and approved publication/catalog records.
- Infrastructure operators/regions/capacity/certifications and enterprise/government commitments or SLAs.
- Approved specialized agreements, DPA/BAA/subprocessors/startup/bundle terms and commercial prices outside canonical configuration.

## Artifacts and preserved references

- `docs/spec400/interaction-inventory-successor-2026-10-19.json`: 230-ID inheritance index, successor contracts, 75 configuration/19 branch/12 public-template maps, route denominators, source hashes and finite remainder.
- `../kova-spec400-independent-review/current-interaction-inventory.json` and `.md`: unchanged cf083bb baseline.
- `../kova-spec400-independent-review/project-controls-990b2c8.json`: original 70 nested conditional records; no renumbering.
- `../kova-spec400-independent-review/additional-controls-1fc515e.json`: original finite additional census and route mapping.
- `../kova-spec400-independent-review/partial-state-audit-b96/audit.md`: source queue baseline, superseded only where explicit successor mapping exists.
- `../kova-spec400-independent-review/remaining-native-gate-b96d38e.md`: bounded native-evidence matrix; not a new broad redesign.

No summed completed-page count or full 400 completion percentage is derived from this supplement.

## Exact final source snapshot

All current application hashes and anchors now come directly from committed application `1b583398`, not from a changing worktree. Adapter `972311cb` changes five review-kit files only; its inert session-rejection/retry-delay cases supply no new rendered or live evidence. The JSON includes 85 application-source hashes, five adapter-file hashes, and the original capture identity under `prior_capture`.

The seven newly mapped records and eight existing records whose implementation hashes changed are source-only. Eight earlier narrow implementation-equality claims remain inherited with their exact receipt/application attribution; the entire current native pass is still unverified by this document.

At the final documentation handoff, `src/components/Sidebar.tsx`, `src/components/ChatInput.tsx` and `src/routes/index.tsx` had later worktree changes. Those bytes are deliberately excluded from the named final application snapshot and need their own successor reconciliation if adopted. The earlier SettingsDialog/index drift is resolved by the committed hashes; it is retained only as historical capture metadata.

## Proposed acceptance-note corrections only

`docs/spec400/acceptance.json` was read and remains unchanged. This is a notes-only proposal from the 75-row partial/prepared audit, not a patch application, status change or whole-requirement closure. Exact old-note excerpts, full replacement prose and final-source anchors are embedded under `acceptance_note_proposals` in the JSON.

### Five literal stale source claims

| Item | Outdated note excerpt                                                                                                  | Proposed correction and retained limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 46   | Sidebar fallback Account/initial and default Free remain in source                                                     | Actual profile identity fields are used when present; Profile read-only identity remains historically checked at 638. Final Sidebar source uses the actual name/email, a neutral icon without a known name, Loading account/plan states and Plan unavailable; a Free label is shown only for a ready tier result. Loading, unknown identity/plan and account-transition rendering remain unverified here; no full identity-flow acceptance is established.                                                              |
| 114  | shared Radio menu items render a filled dot                                                                            | Shared DropdownMenu and ContextMenu radio items now render checkmarks, as do checkbox items and SearchablePicker selections. MenubarRadioItem still uses a filled Circle in an unused shared primitive; no non-ui consumer was found. Selected-state behavior across actual menu families, including the short branch selector, remains separately unverified; shared source does not establish universal acceptance.                                                                                                   |
| 120  | Long-task errors are a generic alert rather than consistently field-associated messages                                | Auth/project/task forms have persistent labels and scoped helpers/errors. Scheduled-task source now supplies visited/submitted field-associated errors and a linked focusable summary; the earlier 990 Title-validation observation keeps its original attribution. Sidebar rename now has a visible Chat name label. Project-chat rename still has only an aria-label, and the Share recipient helper remains below its input. Global form-label/error placement and changed-layout rendering remain open.             |
| 188  | True Send next during generation lacks an established queue contract.                                                  | The next prompt remains editable during generation. Final source adds an explicit Send next action that snapshots one in-memory principal/conversation/privacy-scoped prompt and sends it sequentially through the existing handler only after successful completion. Stop, failure or changed scope holds it for a user decision; typing alone never queues. This is not a durable/background queue or a production scheduling contract, and its changed runtime/rendered paths remain unverified here.                |
| 358  | Resend cooldown comes from existing client policy (auth.tsx:288, 307), not a newly verified service availability field | Single authenticator-code fields allow paste and one-time-code autofill. Kova verification resend now parses an available Retry-After response header, including integer-second and HTTP-date delays. Magic-link requests and verification responses without that header retain local-policy cooldowns; the success response still supplies no next-allowed timestamp. Current countdown text is labeled local delay even when the header supplied it. No live resend/verification flow or email delivery is certified. |

### Separate precision updates and historical-only corrections

- Optional source clarifications: **161, 162, 164** (actual bounded project/pinned context), **175** (authoritative Attach allowance read), **190** (request-scoped retry status, still no transport-health contract), **360** (401/session notice and draft-protected sign-in, still no end-to-end reauthentication proof). These old notes were vague or narrower, not all literally false.
- Historical-only note corrections: **136** (sealed Library/Projects/Tasks/directory empty evidence) and **138** (sealed Project Tasks/Memory error/retry/focus evidence). Preserve the cited earlier app/adapter identity; no final-source pixel claim follows.
- The proposal separately records **19 audit-only groups** whose source-gap findings were never literal acceptance-note claims. Do not silently rewrite notes as if they had made those claims. The pointer-alternative supplement at **371** remains outside the original 75-row set.

Retained boundaries include delivery/transport/remote Stop/durable queue, recoverable server project-chat Trash, invoice and owner facts, production resend/reauthentication, Help dirty-navigation/draft preservation, and remaining named small-form validation/dismissal details. These are not closed by source hashes or earlier fixtures.

Acceptance-file SHA-256 at proposal: `56f5b1860d5c1beb74755e62cb126157ff37424c4275fab16b53f7080e912a9f`. All item `status`, `whole_requirement_closed`, evidence attribution and top-level acceptance/completion fields remain untouched.
