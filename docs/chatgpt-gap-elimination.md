# ChatGPT gap elimination ledger

Audited 2026-07-27. “Complete” means KovaGPT has a discoverable, functional workflow; it does not claim identical proprietary model behavior. No meaningful frontend-feasible item remains classified Partial or Missing after this checkpoint.

| Capability                                                                                  | Classification                 | KovaGPT surface / remaining dependency                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Conversation creation, rename, duplicate, pin, archive, restore, permanent archive deletion | COMPLETE                       | Chat sidebar, context menu, Archived Chats manager                                                                      |
| Full-history search by title and message content                                            | COMPLETE                       | Command Palette search                                                                                                  |
| Search operators for title, dates, pins, and attachments                                    | COMPLETE                       | `in:title:`, `after:`, `before:`, `is:pinned`, `has:attachment`, including negative pin/attachment filters              |
| Conversation branching and source navigation                                                | COMPLETE                       | Message action and branch origin metadata                                                                               |
| Conversation sharing and member entry points                                                | COMPLETE                       | Share and member dialogs                                                                                                |
| Temporary Chat                                                                              | COMPLETE                       | Non-durable chat mode and memory exclusion                                                                              |
| Projects, instructions, files, memory, search, roles, comments                              | COMPLETE                       | Project workspaces and authenticated functions                                                                          |
| Realtime Project/Canvas collaboration                                                       | BACKEND REQUIRED               | Presence transport, revisions, and conflict persistence                                                                 |
| Library, images, files, downloads, multi-select, bulk actions                               | COMPLETE                       | Library, Images, Files                                                                                                  |
| File replacement/versioning across devices                                                  | BACKEND REQUIRED               | Versioned file schema and transactional storage operations                                                              |
| Canvas, writing, code, artifacts, versions, compare, comments, export                       | COMPLETE                       | Artifact Editor                                                                                                         |
| Markdown, tables, code copy, charts and CSV export                                          | COMPLETE                       | Chat Message and Chat Chart                                                                                             |
| Search and web citations                                                                    | COMPLETE                       | Search provider and citation rendering                                                                                  |
| Provider-native citation previews and ranking parity                                        | PROVIDER REQUIRED              | Stable provider provenance and ranking metadata                                                                         |
| Deep Research planning, templates, allowlists, reports and export                           | COMPLETE                       | Research Planner and research persistence                                                                               |
| Live research pause, redirect and provider resume                                           | PROVIDER REQUIRED              | Controllable provider run IDs                                                                                           |
| Image generation, gallery, download, Library save and variations                            | COMPLETE                       | Images workspace                                                                                                        |
| Mask editing and inpainting                                                                 | PROVIDER REQUIRED              | Image-edit API with masks                                                                                               |
| Memory management, sources, edit, delete and merge                                          | COMPLETE                       | Memory Center                                                                                                           |
| Per-answer memory attribution                                                               | BACKEND REQUIRED               | Durable prompt-assembly attribution records                                                                             |
| Apps directory, permissions and Gmail/Calendar/Drive actions                                | COMPLETE                       | Apps and Google connector tools                                                                                         |
| Additional connector breadth                                                                | PROVIDER REQUIRED              | Supported OAuth scopes and APIs per connector                                                                           |
| Scheduled tasks, recurrence, pause, resume, retry and history                               | COMPLETE                       | Scheduled Tasks                                                                                                         |
| Durable autonomous background agents                                                        | BACKEND REQUIRED               | Queue, worker, lease, approval and execution-log infrastructure                                                         |
| Voice conversation                                                                          | PROVIDER REQUIRED              | Realtime speech provider and transport; frontend session contract is ready                                              |
| Prompt workflows and reusable templates                                                     | COMPLETE                       | Prompt Studio                                                                                                           |
| Workspace recents, continuity, context packs and universal capture                          | COMPLETE                       | Recents, handoffs and Kova Lens                                                                                         |
| Workspace relationship and evolution workflows                                              | COMPLETE                       | Knowledge Graph, Timeline, Health, DNA and Time Machine                                                                 |
| Model picker and tool modes                                                                 | COMPLETE                       | Responsive model selector and composer tools                                                                            |
| Notifications and notification preferences                                                  | COMPLETE                       | Notifications and Settings                                                                                              |
| Keyboard shortcuts, command history, pins and fuzzy commands                                | COMPLETE                       | Settings shortcuts and Command Palette                                                                                  |
| Data export, privacy and account controls                                                   | BACKEND READY                  | Device export plus private asynchronous cloud export; authenticated UI wiring and production worker verification remain |
| Enterprise SSO, SCIM, retention and organization enforcement                                | BACKEND REQUIRED               | Organization and policy services                                                                                        |
| Identical model routing, memory ranking and research synthesis                              | OPENAI INFRASTRUCTURE REQUIRED | Private models, routing, indexes and evaluations                                                                        |

## Closed in Project Ascension

- Added full conversation-content search rather than title-only matching.
- Added operator-aware filtering for pinned chats, attachments, title scope, and update-date ranges.
- Added a discoverable Archived Chats manager with search, restore, and permanent deletion.
- Replaced the one-way archive implementation with reusable archive storage functions and a recovery workflow.

## KovaGPT capabilities beyond ChatGPT parity

- Kova Lens universal selection-to-Chat/Work/Research/Context Pack/Library continuity.
- Workspace Health with explainable stalled-work detection.
- Workspace DNA comparative evolution.
- Authorization-aware Workspace Time Machine.
- Explicit Knowledge Graph relationships and timeline.
- Universal Context Packs spanning workspace resource types.
- Prompt Studio evaluations and project/context associations.
- Deterministic Universal AI Pipeline Simulator.
- Automation Builder using existing scheduled-task APIs.
