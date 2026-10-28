# Kova UI reference coverage

The owner's assignment is ChatGPT for buttons, Grok/x.ai for spacing and quiet
modern surfaces, and Claude for serif display/reading text with sans interface
controls. Kova keeps its own product identity. These are implementation roles;
this document does not assert exact pixel parity with every state of another
product.

Reference observations are retained in
[the inspected design contract](../interface-refinement-20261027/DESIGN.md).
That record covers public pages inspected on 2026-10-28. Measurements from those
pages do not establish the geometry of private account screens or every mobile
state. The dimensions selected below are explicit Kova implementation choices.

## Finite source inventory

An offline scan of base commit `3baf901e4c5ce88ef423155f942f7f75233f3a65`
found 214 `createFileRoute` declarations: 78 UI route templates and 136 service
route templates. The root router wrapper is separate from those declarations.
There are 13 registered capabilities and 206 TSX component files; 50 component
files consume a shared Dialog, AlertDialog, Sheet or MobileBottomSheet.
Six component files also contain custom dialog-role surfaces or dialog-role
selectors: ArchivedChatsDialog, ChatInput, CommandPalette, DeveloperConsole,
ResponsiveModelSelector and Sidebar.

The 13 families below partition all 78 UI templates. Parameterized routes cover
many data/content entries through the same component. A source family mapping
establishes shared styling coverage, not proof that every private record and
interaction has been rendered.

Do not use `scripts/ui-surface-inventory.mjs` as a visual-completion percentage.
It fetches public OpenAI/ChatGPT sitemaps and measures matching URL paths. Its
existing September report predates this source and measures a different task.

## Shared pattern roles

| Role                                 | Assigned reference | Kova implementation                                                                                                                                           |
| ------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary actions                     | ChatGPT            | Neutral filled primary action, quiet secondary action, pill shape, 44px minimum interactive target, visible keyboard focus.                                   |
| Selection rows and menus             | ChatGPT            | Compact rounded rows with explicit selected, disabled and keyboard states; preserve listbox/menu semantics rather than turning an entire surface into a pill. |
| Layout and surfaces                  | Grok/x.ai          | Restrained borders and shadows; 8/12/16/24px spacing rhythm; bounded readable columns and responsive page gutters.                                            |
| Page/dialog titles and reading prose | Claude             | Serif display/reading role using the observed Georgia fallback; regular display weight and a clear size hierarchy.                                            |
| Navigation, forms and metadata       | Claude             | Sans interface role; code and structured editor content retain monospace.                                                                                     |
| Product identity                     | Kova               | Existing supplied mark; 24px navigation placement and 32px auth/status placement.                                                                             |

Shared ownership lives in `src/styles/visual-tokens.css`,
`src/styles/reference-surfaces.css`, `src/styles/assistant-modern.css` and the
`src/components/ui` primitives. The reference layer is imported after the
assistant overlay layer in `src/styles.css`; component hooks provide additional
scope where a feature has a custom frame.

## Route families

The checks column names existing checks relevant to the family. It is a
verification plan, not a claim that every listed test has run in this pass.

| Family                                       | UI templates                                                                                                                                                                                                                                                                                                                                                                              | Reference treatment and shared source                                                                                                                                                                                    | Relevant existing checks                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Conversations                             | `/`; `/projects/$projectId/chat/$chatId`                                                                                                                                                                                                                                                                                                                                                  | ChatGPT controls, Grok composer/reading column, Claude reading hierarchy. `ChatInput`, `ChatMessage`, `ResponseMarkdown`, `assistant-modern.css`; both assistant and project-chat shell roots inherit the reading roles. | `ui-quality.spec.ts`, `model-selector.spec.ts`, `response-action-spacing.test.mjs`, `response-action-tooltips.test.mjs`                                        |
| 2. Projects and saved files                  | `/projects`; `/projects/$projectId`; `/library`; `/files`; `/share-inbox`                                                                                                                                                                                                                                                                                                                 | ChatGPT directory/list actions with Grok whitespace, restrained cards and Claude page titles. `WorkspacePageHeader`, `file-directories.css`, Library and project dialogs.                                                | `projects-library-workspaces.spec.ts`, `workspace-visual-coherence.spec.ts`, `library-version-history.spec.ts`                                                 |
| 3. Discovery and connectors                  | `/apps`; `/discovery`; `/kovas`; `/admin/kovas`                                                                                                                                                                                                                                                                                                                                           | ChatGPT search, menu and connection-action patterns; Grok catalogue spacing; Claude titles. Shared AppShell, control primitives and connector frames.                                                                    | `connectors-tasks-settings.spec.ts`, `workspace-visual-coherence.spec.ts`, `apps-provider-dialog-focus.test.mjs`                                               |
| 4. Images                                    | `/images`                                                                                                                                                                                                                                                                                                                                                                                 | ChatGPT prompt/gallery actions with Grok surface and spacing roles; Claude heading role. The image page participates in the modern shell contract. Fullscreen media remains edge-to-edge.                                | `workspace-visual-coherence.spec.ts`, `image-lightbox-primary-focus.test.mjs`, `image-result-reveal.test.mjs`, `image-action-lifetime.test.mjs`                |
| 5. Work and rich tools                       | `/work`; `/brain`; `/omega`; `/knowledge-graph`; `/maps`; `/sites`                                                                                                                                                                                                                                                                                                                        | ChatGPT tool/output framing and controls; Grok workspace spacing; Claude reading/title roles. Shared controls frame task-specific browser, map, graph and canvas contents.                                               | `work-model-controls.spec.ts`, `multimodal-canvas.spec.ts`, `apollo-agent-workspace.test.mjs`, `maps-experience.test.mjs`                                      |
| 6. Writing, study and context                | `/write`; `/writing/`; `/study`; `/summary`; `/prompt-studio`; `/context-packs`; `/memory`                                                                                                                                                                                                                                                                                                | Claude reading/title hierarchy with ChatGPT form/editor actions and Grok panel rhythm. Explicit code/editor fonts remain intact.                                                                                         | `writing-tools.spec.ts`, `study-practice.spec.ts`, `workspace-route-state-integrity.spec.ts`, `writing-controls-truth-source.test.mjs`                         |
| 7. Tasks and notifications                   | `/scheduled-tasks`; `/goals`; `/notifications`                                                                                                                                                                                                                                                                                                                                            | ChatGPT list, filter, status and editor actions; Grok spacing; Claude page/dialog titles. Existing availability, task-history and notification states keep their actual meaning.                                         | `scheduled-task-editor.spec.ts`, `connectors-tasks-settings.spec.ts`, `notification-center-source.test.mjs`, `scheduled-task-action-feedback-runtime.test.mjs` |
| 8. Settings and administration               | `/settings/$section`; `/organization`; `/audit-log`; `/trusted-contacts`                                                                                                                                                                                                                                                                                                                  | ChatGPT settings navigation and controls; Grok form-row/section rhythm; Claude title role. `settings-reference.css`, `settings-page-layout.css`, `appearance-settings.css`, shared Dialog and form primitives.           | `settings-theme-transition.spec.ts`, `connectors-tasks-settings.spec.ts`, `organization-scim.spec.ts`, `settings-ux-contract.test.mjs`                         |
| 9. Sign-in and recovery                      | `/auth`; `/oauth/consent`; `/~oauth/callback`; `/reset-password`; `/checkout/return`; `/unsubscribe`                                                                                                                                                                                                                                                                                      | ChatGPT pill actions and 44px controls; Grok quiet panels and 24px section rhythm; Claude serif headings. Auth/status mark remains 32px. Existing provider and recovery behavior is preserved.                           | `auth-entry-and-dialog.spec.ts`, `auth-visual-regression.spec.ts`, `auth-entry-and-dialog-source.test.mjs`, `keyboard-and-auth-continuity-source.test.mjs`     |
| 10. Public product entry points              | `/$locale/home`; `/$slug`; `/assistants`; `/assistants/$assistantSlug`; `/ai-writer`; `/ai-humanizer`; `/ai-image-generator`; `/humanize-ai-text`; `/chatgpt-alternative`; `/code-helper`; `/research-assistant`; `/study-assistant`                                                                                                                                                      | Grok restrained editorial surfaces and spacing; Claude display hierarchy; ChatGPT action treatment. PublicSite/PublicShell families share the same typography and button roles.                                          | `public-shell.spec.ts`, `public-surface-matrix.spec.ts`, `public-detail-pages.spec.ts`, `public-foundation.spec.ts`                                            |
| 11. Public information and content           | `/$section/$articleSlug`; `/$section/$category/$articleSlug`; `/$section/$category/$subcategory/$articleSlug`; `/academy`; `/ai-safety`; `/blog/ai-market-research-guide`; `/blog/best-ai-assistants`; `/blog/best-ai-market-research-tools`; `/changelog`; `/connect`; `/contact-support`; `/getting-started`; `/help`; `/modes`; `/pricing`; `/privacy`; `/refund`; `/status`; `/terms` | Claude editorial headings and readable content; Grok whitespace; ChatGPT links, forms and disclosure actions. Public and legal templates retain their content and availability disclosures.                              | `public-detail-pages.spec.ts`, `public-surface-matrix.spec.ts`, `public-shell.spec.ts`, `public-navigation-focus.test.mjs`                                     |
| 12. Developer portal                         | `/developers/`; `/developers/$docSlug`; `/developers/authorize`; `/developers/connections`; `/developers/console`; `/developers/pricing`                                                                                                                                                                                                                                                  | Claude display hierarchy, ChatGPT form/tab actions and Grok panel spacing. PublicShell typography applies around code and console content, which remain monospace where appropriate.                                     | `public-detail-pages.spec.ts`, `public-shell.spec.ts`, `developer-console-principal.test.mjs`, `public-surface-matrix.spec.ts`                                 |
| 13. Translation and public writing templates | `/translate/`; `/translate/$pairSlug`; `/writing/$toolSlug`                                                                                                                                                                                                                                                                                                                               | ChatGPT paired inputs and action controls, Grok space between input/output surfaces, Claude heading/reading roles. Existing language and tool behavior is retained.                                                      | `translation-family.spec.ts`, `writing-tools.spec.ts`, `translation-workspace-runtime.test.mjs`, `writing-tool-family.test.mjs`                                |

Capability coverage: chat → family 1; projects/library/files → family 2;
apps → family 3; images → family 4; work/knowledge-graph/omega → family 5;
memory/context-packs/prompt-studio → family 6; automations → family 7.

## Custom surfaces outside shared primitives

| Surface                           | Stable scope and treatment                                                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command palette                   | `data-slot="command-palette-overlay"` and `command-palette-content`; 720px maximum width, 24px panel radius, 16/24px header gutters, 44px search/close controls, compact result rows and a viewport-bounded internal scroller. Keyboard navigation, IME handling and command dispatch are unchanged. |
| Paid model picker                 | `data-slot="model-selector-trigger"`, `model-selector-content` and `model-selector-option`; 44px pill trigger, 18px menu radius, 8px menu inset and compact selection rows. Desktop portal/collision handling and mobile-sheet flow remain intact.                                                   |
| Workspace search                  | `data-slot="workspace-search"`, `workspace-search-title` and `workspace-search-submit`; 16/24px panel padding, serif section title, sans controls and 44px search action. Principal-bound requests and result filtering are unchanged.                                                               |
| Archived chats                    | `data-slot="archived-chats-overlay"` and `archived-chats-content`; the visual child panel has a 24px radius, serif 24px heading and 44px actions. The fullscreen overlay, mobile bottom anchoring and internal scrolling keep their distinct geometry.                                               |
| Development inspector             | `data-slot="developer-console"`; preserve the existing fixed side-panel placement and instrumentation. A 24px quiet frame, serif heading, 44px close control and wrapping header align it with the shared system. This surface remains development-gated.                                            |
| Attach, Context and Options       | Existing `.kova-composer-menu` and `.spec400-*` hooks keep their collision, scroll and nested-menu behavior while sharing palette/type/spacing roles.                                                                                                                                                |
| Sidebar drawer and image lightbox | Preserve viewport-edge and fullscreen geometry; apply controls/type/surface roles without blanket dialog padding or corner rules.                                                                                                                                                                    |

## Rendered verification and limits

Check representative renders at 320/390px phone, 1024px tablet and 1440px desktop
in light and dark themes. Review the resting shell, expanded/collapsed sidebar,
long menu labels, search results, nested model picker, settings, directory
list/grid, public article/form and rich conversation output. Retain keyboard
focus, Escape/return-focus behavior, reduced motion, safe areas and overflow
checks.

Source coverage and passing source/unit tests do not establish complete visual
coverage. Public or signed-out discovery checks do not prove generated-image
lightboxes, every authenticated administration state or every private record.
Use existing isolated authenticated fixtures for those states; do not require
production personal data or real provider/model/payment operations for a UI
refinement.

The previous main-chat/auth screenshots remain evidence for their recorded
source only. New screenshot baselines must come from the changed application
and be inspected before acceptance. Code/preformatted output keeps monospace;
tables, control chrome, metadata and compact selection rows keep sans type.
