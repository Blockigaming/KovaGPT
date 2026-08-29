# KovaGPT UI Surface Parity

This file is generated from the repository inventory and the finalized product requirements.

A route existing does **not** mean that surface is complete.

## Required product surfaces

| Priority | Surface                       | Expected Kova surface               |
| -------- | ----------------------------- | ----------------------------------- |
| P0       | Core chat                     | `/`                                 |
| P0       | Conversation search/history   | `Sidebar + command palette`         |
| P0       | Temporary Chat                | `Chat mode`                         |
| P0       | Projects                      | `/projects`                         |
| P0       | Project workspace             | `/projects/$projectId`              |
| P0       | Project conversation          | `/projects/$projectId/chat/$chatId` |
| P0       | Files                         | `/files`                            |
| P0       | Library                       | `/library`                          |
| P0       | Images                        | `/images`                           |
| P0       | Deep Research                 | `/research-planner + chat mode`     |
| P0       | Study mode                    | `/study-assistant + chat mode`      |
| P0       | Data analysis                 | `Chat tool`                         |
| P0       | Canvas / artifacts            | `ArtifactEditor`                    |
| P0       | Work / long-running execution | `/work`                             |
| P0       | Scheduled Tasks               | `/scheduled-tasks`                  |
| P0       | Apps / connectors             | `/apps`                             |
| P0       | Custom assistants / Kovas     | `/assistants`                       |
| P0       | Assistant detail              | `/assistants/$assistantSlug`        |
| P0       | Memory                        | `/memory + Settings`                |
| P1       | Notifications                 | `/notifications + Settings`         |
| P0       | Sharing                       | `ShareChatDialog + Projects`        |
| P0       | Settings                      | `SettingsDialog`                    |
| P0       | Authentication                | `/auth + dialogs`                   |
| P0       | Password recovery             | `/reset-password`                   |
| P0       | Pricing / plans               | `/pricing`                          |
| P0       | Billing return/recovery       | `/checkout/return`                  |
| P1       | Help                          | `/help`                             |
| P1       | Contact support               | `/contact-support`                  |
| P1       | Getting started               | `/getting-started`                  |
| P1       | Developer platform            | `/developers`                       |
| P1       | OAuth consent                 | `/oauth/consent`                    |
| P1       | Status                        | `/status`                           |
| P0       | Privacy                       | `/privacy`                          |
| P0       | Terms                         | `/terms`                            |
| P1       | Safety                        | `/ai-safety`                        |

## Discovered user-facing routes

| Route                                 | Source                                              | Shell | Loading | Empty | Error | Retry | Risk marker |
| ------------------------------------- | --------------------------------------------------- | ----: | ------: | ----: | ----: | ----: | ----------: |
| `/$locale/home`                       | `src/routes/$locale.home.tsx`                       |       |         |       |       |       |             |
| `/$section/$articleSlug`              | `src/routes/$section.$articleSlug.tsx`              |       |         |       |       |       |             |
| `/$slug`                              | `src/routes/$slug.tsx`                              |       |         |     ✓ |       |       |             |
| `/ai-humanizer`                       | `src/routes/ai-humanizer.tsx`                       |       |         |       |       |       |             |
| `/ai-image-generator`                 | `src/routes/ai-image-generator.tsx`                 |       |         |       |     ✓ |       |             |
| `/ai-safety`                          | `src/routes/ai-safety.tsx`                          |       |         |       |       |       |             |
| `/ai-writer`                          | `src/routes/ai-writer.tsx`                          |       |         |       |       |       |             |
| `/apps`                               | `src/routes/apps.tsx`                               |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/assistants/$assistantSlug`          | `src/routes/assistants.$assistantSlug.tsx`          |       |         |       |     ✓ |       |             |
| `/assistants`                         | `src/routes/assistants.tsx`                         |       |         |     ✓ |       |       |           ⚠ |
| `/audit-log`                          | `src/routes/audit-log.tsx`                          |       |       ✓ |     ✓ |     ✓ |     ✓ |             |
| `/auth`                               | `src/routes/auth.tsx`                               |       |       ✓ |       |     ✓ |     ✓ |           ⚠ |
| `/blog/ai-market-research-guide`      | `src/routes/blog.ai-market-research-guide.tsx`      |       |         |     ✓ |       |       |             |
| `/blog/best-ai-assistants`            | `src/routes/blog.best-ai-assistants.tsx`            |       |         |       |       |       |             |
| `/blog/best-ai-market-research-tools` | `src/routes/blog.best-ai-market-research-tools.tsx` |       |         |       |     ✓ |       |             |
| `/brain`                              | `src/routes/brain.tsx`                              |     ✓ |       ✓ |       |     ✓ |     ✓ |           ⚠ |
| `/changelog`                          | `src/routes/changelog.tsx`                          |       |         |     ✓ |       |       |             |
| `/chatgpt-alternative`                | `src/routes/chatgpt-alternative.tsx`                |       |         |       |       |       |             |
| `/checkout/return`                    | `src/routes/checkout.return.tsx`                    |       |         |       |       |       |             |
| `/code-helper`                        | `src/routes/code-helper.tsx`                        |       |         |       |     ✓ |       |             |
| `/connect`                            | `src/routes/connect.tsx`                            |       |       ✓ |       |       |       |             |
| `/contact-support`                    | `src/routes/contact-support.tsx`                    |       |         |       |       |       |             |
| `/context-packs`                      | `src/routes/context-packs.tsx`                      |     ✓ |       ✓ |       |     ✓ |     ✓ |           ⚠ |
| `/developers/$docSlug`                | `src/routes/developers.$docSlug.tsx`                |       |         |       |     ✓ |       |             |
| `/developers/index`                   | `src/routes/developers.index.tsx`                   |       |         |       |       |       |             |
| `/files`                              | `src/routes/files.tsx`                              |     ✓ |       ✓ |       |     ✓ |       |           ⚠ |
| `/getting-started`                    | `src/routes/getting-started.tsx`                    |       |         |       |       |       |             |
| `/goals`                              | `src/routes/goals.tsx`                              |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/help`                               | `src/routes/help.tsx`                               |       |         |       |     ✓ |     ✓ |           ⚠ |
| `/humanize-ai-text`                   | `src/routes/humanize-ai-text.tsx`                   |       |         |       |       |       |             |
| `/images`                             | `src/routes/images.tsx`                             |       |       ✓ |     ✓ |     ✓ |       |           ⚠ |
| `/`                                   | `src/routes/index.tsx`                              |       |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/knowledge-graph`                    | `src/routes/knowledge-graph.tsx`                    |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/library`                            | `src/routes/library.tsx`                            |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/maps`                               | `src/routes/maps.tsx`                               |     ✓ |         |       |       |       |             |
| `/memory`                             | `src/routes/memory.tsx`                             |     ✓ |       ✓ |       |     ✓ |       |           ⚠ |
| `/modes`                              | `src/routes/modes.tsx`                              |       |         |       |       |       |             |
| `/notifications`                      | `src/routes/notifications.tsx`                      |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/oauth/consent`                      | `src/routes/oauth.consent.tsx`                      |       |       ✓ |       |     ✓ |       |             |
| `/omega`                              | `src/routes/omega.tsx`                              |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/pricing`                            | `src/routes/pricing.tsx`                            |       |         |       |       |       |             |
| `/privacy`                            | `src/routes/privacy.tsx`                            |       |         |       |     ✓ |       |             |
| `/projects/$projectId/chat/$chatId`   | `src/routes/projects.$projectId.chat.$chatId.tsx`   |     ✓ |       ✓ |       |     ✓ |       |           ⚠ |
| `/projects/$projectId`                | `src/routes/projects.$projectId.tsx`                |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/projects`                           | `src/routes/projects.tsx`                           |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/prompt-studio`                      | `src/routes/prompt-studio.tsx`                      |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/refund`                             | `src/routes/refund.tsx`                             |       |         |       |     ✓ |       |             |
| `/research-assistant`                 | `src/routes/research-assistant.tsx`                 |       |         |       |       |       |             |
| `/research-planner`                   | `src/routes/research-planner.tsx`                   |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/reset-password`                     | `src/routes/reset-password.tsx`                     |       |       ✓ |       |     ✓ |     ✓ |             |
| `/scheduled-tasks`                    | `src/routes/scheduled-tasks.tsx`                    |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/status`                             | `src/routes/status.tsx`                             |       |       ✓ |       |       |     ✓ |             |
| `/study-assistant`                    | `src/routes/study-assistant.tsx`                    |       |         |       |       |       |             |
| `/summary`                            | `src/routes/summary.tsx`                            |     ✓ |       ✓ |     ✓ |     ✓ |       |             |
| `/terms`                              | `src/routes/terms.tsx`                              |       |         |       |       |       |             |
| `/unsubscribe`                        | `src/routes/unsubscribe.tsx`                        |       |       ✓ |       |     ✓ |     ✓ |             |
| `/work`                               | `src/routes/work.tsx`                               |     ✓ |       ✓ |     ✓ |     ✓ |     ✓ |           ⚠ |
| `/write`                              | `src/routes/write.tsx`                              |     ✓ |         |       |     ✓ |       |           ⚠ |
| `/~oauth/callback`                    | `src/routes/~oauth.callback.tsx`                    |       |         |       |     ✓ |     ✓ |             |
