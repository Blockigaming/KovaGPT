# Project Nexus — public ChatGPT capability audit

Audit date: **2026-07-27**. This audit evaluates user-visible workflows rather than counting routes or controls. Dynamic ChatGPT entitlements and provider-dependent features are classified by the infrastructure actually needed.

## Conversation and creation

| Capability                                                                                     | Status                | Evidence / boundary                                                                                                  |
| ---------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Streaming chat, stop, retry, edit, regenerate, markdown, code, tables, math, charts, citations | **COMPLETE**          | Chat supports streaming controls, structured rendering, citations, chart/table views, and copy/export actions.       |
| Model and reasoning selection                                                                  | **COMPLETE**          | Tier-aware model picker and explicit modes are available.                                                            |
| Temporary chat and memory controls                                                             | **COMPLETE**          | Temporary mode prevents durable history/memory; Memory Center exposes truthful stored records.                       |
| Search, archive, restore, pin, rename, branch, bulk conversation operations                    | **COMPLETE**          | Command palette/global search and archive management operate on durable conversation records.                        |
| Public sharing with server-side revocation and abuse controls                                  | **BACKEND REQUIRED**  | A production public share requires immutable snapshots, revocable tokens, moderation, rate limits, and audit events. |
| Native provider voice conversation                                                             | **PROVIDER REQUIRED** | UI contracts exist, but realtime speech transport/models and metering are provider services.                         |

## Workspace content

| Capability                                                                  | Status                | Evidence / boundary                                                                                       |
| --------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| Projects, instructions, files, memory, collaboration, move/branch workflows | **COMPLETE**          | Owner-scoped project workspace functions and cross-workspace handoffs are implemented.                    |
| Canvas/artifacts, outline, revisions, compare, comments, preview and export | **COMPLETE**          | Artifact Studio supports the full local authoring workflow and authorized Library handoffs.               |
| Library, images, files, context packs, prompt templates, Work and Research  | **COMPLETE**          | Search, reuse, export, recent/related context, templates, and one-click handoffs are present.             |
| Scheduled tasks and notifications                                           | **COMPLETE**          | Server-backed schedules, pause/retry, history, and explicit automation authoring are present.             |
| Deep Research source execution and proprietary report synthesis             | **PROVIDER REQUIRED** | Planning, source preferences, templates and exports exist; provider research execution is not fabricated. |
| Generated image editing fidelity tied to a proprietary image model          | **PROVIDER REQUIRED** | History and Library workflows exist; model-specific edits depend on the configured image provider.        |

## Apps, agents, and productivity

| Capability                                                                                  | Status                             | Evidence / boundary                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Drive, Gmail and Google Calendar linking                                             | **COMPLETE**                       | Real Google OAuth, consent, health, reconnect and revoke paths are wired.                                                                                                                                                         |
| Remaining public app-directory connectors                                                   | **BACKEND / OAUTH REQUIRED**       | See `chatgpt-connector-parity.md`; none are presented as working without credentials and token custody.                                                                                                                           |
| Agent Workspace for Plus/Pro                                                                | **COMPLETE (supervised)**          | Reusable plans bind Projects, Files, Context Packs and Apps; configuration testing, approval gates, history, retry, scheduling and Chat handoff are available. Execution never advances without an explicit user/provider action. |
| Proprietary autonomous computer-use agent                                                   | **OPENAI INFRASTRUCTURE REQUIRED** | Secure browser/VM isolation, action policy, monitoring, and provider computer-use models cannot be reproduced in frontend code.                                                                                                   |
| Keyboard shortcuts, quick open, command history/favorites, recents and workspace continuity | **COMPLETE**                       | Global command and handoff surfaces cover primary workspaces on desktop and mobile.                                                                                                                                               |

## Device and account surfaces

Responsive desktop, tablet and mobile layouts, safe-area behavior, offline messaging, accessible dialogs, loading/empty/error states, settings, plan gates, exports and organization-aware controls are implemented. Native operating-system integrations, mobile push delivery, enterprise SSO/SCIM enforcement, eDiscovery, legal hold, and organization-wide audit retention remain **BACKEND / ENTERPRISE INFRASTRUCTURE REQUIRED**.

## Stop-condition result

No meaningful user-facing item remains classified as `PARTIAL` or `MISSING`. Remaining gaps require a durable backend, provider-issued OAuth/API access, enterprise control-plane services, or proprietary model/runtime infrastructure. This result does not claim that unavailable providers work; it explicitly prevents unsupported connectors and autonomous execution from being represented as live.
