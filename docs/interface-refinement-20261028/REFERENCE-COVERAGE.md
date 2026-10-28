# Kova UI reference coverage

The owner's latest assignment is Google Drive for the Projects directory;
ChatGPT for page organization, controls, popups and theme presentation;
Gemini/Grok for simplicity; and Claude for the separation between interface type
and contextual reading content. Management, navigation, form and dialog headings
use sans type. Serif is reserved for explicit reading, greeting and editorial
surfaces. This supersedes the earlier broad serif page/dialog-title contract.
Kova keeps its own product identity. These are implementation roles, not a claim
of exact pixel parity with every state of another product.

The current choices and official reference limits are recorded in
[the layout revision](./LAYOUT-REVISION.md).

Reference observations are retained in
[the earlier inspected design contract](../interface-refinement-20261027/DESIGN.md).
That historical record covers public pages inspected on 2026-10-28; its broad
serif-heading assignment is superseded by this revision. Measurements from those
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

| Role                                   | Assigned reference     | Kova implementation                                                                                                                                                                       |
| -------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page organization                      | ChatGPT                | Persistent shell, compact page header and toolbar, bounded content, simple lists and form sections with clear primary actions.                                                            |
| Projects organization                  | Google Drive           | Search/filter/sort/view toolbar; folder-like project entries with name, role, modified date and trailing actions; readable list and grid presentations.                                   |
| Controls and popups                    | ChatGPT                | Neutral primary actions, quiet secondary actions, pill buttons, rounded anchored menus, explicit selection/disabled states and visible keyboard focus. Preserve each control's semantics. |
| Theme presentation                     | ChatGPT                | Shared neutral light/dark surfaces; simple settings rows and aligned appearance controls. Keep Kova's actual theme choices and persistence behavior.                                      |
| Simplicity                             | Gemini/Grok            | Restrained borders and shadows, concise supporting text and fewer competing containers. Do not remove useful states or capabilities to simplify a screen.                                 |
| Interface type                         | Claude role separation | System sans for navigation, management page titles, dialog headings, forms, metadata, tabs and tables. `--font-display` follows the sans UI role.                                         |
| Explicit reading and editorial content | Claude                 | Georgia fallback for opted-in assistant reading, greetings and editorial content; no blanket serif rule for all headings. Code and structured editor content retain monospace.            |
| Product identity                       | Kova                   | Existing supplied mark; 24px navigation placement and 32px auth/status placement.                                                                                                         |

Shared ownership lives in `src/styles/visual-tokens.css`,
`src/styles/reference-surfaces.css`, `src/styles/assistant-modern.css` and the
`src/components/ui` primitives. The reference layer is imported after the
assistant overlay layer in `src/styles.css`; component hooks provide additional
scope where a feature has a custom frame.

## Route families

The checks column names existing checks relevant to the family. It is a
verification plan, not a claim that every listed test has run in this pass.

| Family                                       | UI templates                                                                                                                                                                                                                                                                                                                                                                              | Reference treatment and shared source                                                                                                                                                                                                                                                                                       | Relevant existing checks                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Conversations                             | `/`; `/projects/$projectId/chat/$chatId`                                                                                                                                                                                                                                                                                                                                                  | ChatGPT shell, composer and popup organization; Gemini/Grok restraint; Claude type only in explicit greeting/reading content. `ChatInput`, `ChatMessage`, `ResponseMarkdown`, `assistant-modern.css`; navigation and controls stay sans.                                                                                    | `ui-quality.spec.ts`, `model-selector.spec.ts`, `response-action-spacing.test.mjs`, `response-action-tooltips.test.mjs`                                        |
| 2. Projects and saved files                  | `/projects`; `/projects/$projectId`; `/library`; `/files`; `/share-inbox`                                                                                                                                                                                                                                                                                                                 | Drive-style Projects directory with ChatGPT controls and sans management titles. `.kova-project-directory` scopes its toolbar and entries; project detail exposes Chats, Files and Context with secondary tools retained. `WorkspacePageHeader`, `file-directories.css`, `project-detail.css`, Library and project dialogs. | `projects-library-workspaces.spec.ts`, `workspace-visual-coherence.spec.ts`, `library-version-history.spec.ts`                                                 |
| 3. Discovery and connectors                  | `/apps`; `/discovery`; `/kovas`; `/admin/kovas`                                                                                                                                                                                                                                                                                                                                           | ChatGPT page/search/menu and connection-action organization; quiet Gemini/Grok surfaces and sans management titles. Shared AppShell, control primitives and connector frames.                                                                                                                                               | `connectors-tasks-settings.spec.ts`, `workspace-visual-coherence.spec.ts`, `apps-provider-dialog-focus.test.mjs`                                               |
| 4. Images                                    | `/images`                                                                                                                                                                                                                                                                                                                                                                                 | ChatGPT prompt/gallery page organization and controls; restrained surfaces and sans interface titles. The image page participates in the modern shell contract. Fullscreen media remains edge-to-edge.                                                                                                                      | `workspace-visual-coherence.spec.ts`, `image-lightbox-primary-focus.test.mjs`, `image-result-reveal.test.mjs`, `image-action-lifetime.test.mjs`                |
| 5. Work and rich tools                       | `/work`; `/brain`; `/omega`; `/knowledge-graph`; `/maps`; `/sites`                                                                                                                                                                                                                                                                                                                        | ChatGPT page/tool framing and controls with sans interface headings; Gemini/Grok restraint. Explicit reading content can use the Claude role. Shared controls frame task-specific browser, map, graph and canvas contents.                                                                                                  | `work-model-controls.spec.ts`, `multimodal-canvas.spec.ts`, `apollo-agent-workspace.test.mjs`, `maps-experience.test.mjs`                                      |
| 6. Writing, study and context                | `/write`; `/writing/`; `/study`; `/summary`; `/prompt-studio`; `/context-packs`; `/memory`                                                                                                                                                                                                                                                                                                | ChatGPT page/form/editor organization and sans interface headings; Claude reading hierarchy only for explicit content output. Gemini/Grok simplicity and existing code/editor fonts remain intact.                                                                                                                          | `writing-tools.spec.ts`, `study-practice.spec.ts`, `workspace-route-state-integrity.spec.ts`, `writing-controls-truth-source.test.mjs`                         |
| 7. Tasks and notifications                   | `/scheduled-tasks`; `/goals`; `/notifications`                                                                                                                                                                                                                                                                                                                                            | ChatGPT page/list/filter/status organization and editor controls; compact neutral rows and sans page/dialog headings. Existing availability, task-history and notification states keep their actual meaning.                                                                                                                | `scheduled-task-editor.spec.ts`, `connectors-tasks-settings.spec.ts`, `notification-center-source.test.mjs`, `scheduled-task-action-feedback-runtime.test.mjs` |
| 8. Settings and administration               | `/settings/$section`; `/organization`; `/audit-log`; `/trusted-contacts`                                                                                                                                                                                                                                                                                                                  | ChatGPT settings navigation, shared neutral appearance, simple divided rows and aligned controls; sans titles and concise helper text. `settings-reference.css`, `settings-page-layout.css`, `appearance-settings.css`, shared Dialog and form primitives.                                                                  | `settings-theme-transition.spec.ts`, `connectors-tasks-settings.spec.ts`, `organization-scim.spec.ts`, `settings-ux-contract.test.mjs`                         |
| 9. Sign-in and recovery                      | `/auth`; `/oauth/consent`; `/~oauth/callback`; `/reset-password`; `/checkout/return`; `/unsubscribe`                                                                                                                                                                                                                                                                                      | ChatGPT page/dialog organization, pill actions and controls; quiet panels with sans headings. Auth/status mark remains 32px. Existing provider and recovery behavior is preserved.                                                                                                                                          | `auth-entry-and-dialog.spec.ts`, `auth-visual-regression.spec.ts`, `auth-entry-and-dialog-source.test.mjs`, `keyboard-and-auth-continuity-source.test.mjs`     |
| 10. Public product entry points              | `/$locale/home`; `/$slug`; `/assistants`; `/assistants/$assistantSlug`; `/ai-writer`; `/ai-humanizer`; `/ai-image-generator`; `/humanize-ai-text`; `/chatgpt-alternative`; `/code-helper`; `/research-assistant`; `/study-assistant`                                                                                                                                                      | ChatGPT page/navigation/action organization with restrained Gemini/Grok surfaces. Claude serif is limited to explicitly editorial headings and reading examples; control chrome stays sans. PublicSite/PublicShell families share these roles.                                                                              | `public-shell.spec.ts`, `public-surface-matrix.spec.ts`, `public-detail-pages.spec.ts`, `public-foundation.spec.ts`                                            |
| 11. Public information and content           | `/$section/$articleSlug`; `/$section/$category/$articleSlug`; `/$section/$category/$subcategory/$articleSlug`; `/academy`; `/ai-safety`; `/blog/ai-market-research-guide`; `/blog/best-ai-assistants`; `/blog/best-ai-market-research-tools`; `/changelog`; `/connect`; `/contact-support`; `/getting-started`; `/help`; `/modes`; `/pricing`; `/privacy`; `/refund`; `/status`; `/terms` | Claude editorial headings and readable prose where explicitly scoped; ChatGPT page organization, links, forms and disclosures with sans UI/data. Public and legal templates retain their content and availability disclosures.                                                                                              | `public-detail-pages.spec.ts`, `public-surface-matrix.spec.ts`, `public-shell.spec.ts`, `public-navigation-focus.test.mjs`                                     |
| 12. Developer portal                         | `/developers/`; `/developers/$docSlug`; `/developers/authorize`; `/developers/connections`; `/developers/console`; `/developers/pricing`                                                                                                                                                                                                                                                  | ChatGPT page/form/tab organization and sans portal controls; Claude role for explicit documentation prose/editorial content. Code and structured console content remain monospace where appropriate.                                                                                                                        | `public-detail-pages.spec.ts`, `public-shell.spec.ts`, `developer-console-principal.test.mjs`, `public-surface-matrix.spec.ts`                                 |
| 13. Translation and public writing templates | `/translate/`; `/translate/$pairSlug`; `/writing/$toolSlug`                                                                                                                                                                                                                                                                                                                               | ChatGPT page organization, paired inputs and actions; restrained surfaces and sans management/form headings. Explicit editorial or reading output can use the Claude role. Existing language and tool behavior is retained.                                                                                                 | `translation-family.spec.ts`, `writing-tools.spec.ts`, `translation-workspace-runtime.test.mjs`, `writing-tool-family.test.mjs`                                |

Capability coverage: chat → family 1; projects/library/files → family 2;
apps → family 3; images → family 4; work/knowledge-graph/omega → family 5;
memory/context-packs/prompt-studio → family 6; automations → family 7.

## Custom surfaces outside shared primitives

The numerical dimensions in these scoped contracts are Kova implementation
choices. All management and dialog titles below follow the sans UI role.

| Surface                           | Stable scope and treatment                                                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command palette                   | `data-slot="command-palette-overlay"` and `command-palette-content`; 720px maximum width, 24px panel radius, 16/24px header gutters, 44px search/close controls, compact result rows and a viewport-bounded internal scroller. Keyboard navigation, IME handling and command dispatch are unchanged. |
| Paid model picker                 | `data-slot="model-selector-trigger"`, `model-selector-content` and `model-selector-option`; 44px pill trigger, 18px menu radius, 8px menu inset and compact selection rows. Desktop portal/collision handling and mobile-sheet flow remain intact.                                                   |
| Workspace search                  | `data-slot="workspace-search"`, `workspace-search-title` and `workspace-search-submit`; 16/24px panel padding, sans section title and controls, and 44px search action. Principal-bound requests and result filtering are unchanged.                                                                 |
| Archived chats                    | `data-slot="archived-chats-overlay"` and `archived-chats-content`; the visual child panel has a 24px radius, sans 24px heading and 44px actions. The fullscreen overlay, mobile bottom anchoring and internal scrolling keep their distinct geometry.                                                |
| Development inspector             | `data-slot="developer-console"`; preserve the existing fixed side-panel placement and instrumentation. A 24px quiet frame, sans heading, 44px close control and wrapping header align it with the shared system. This surface remains development-gated.                                             |
| Attach, Context and Options       | Existing `.kova-composer-menu` and `.spec400-*` hooks keep their collision, scroll and nested-menu behavior while sharing palette/type/spacing roles.                                                                                                                                                |
| Sidebar drawer and image lightbox | Preserve viewport-edge and fullscreen geometry; apply controls/type/surface roles without blanket dialog padding or corner rules.                                                                                                                                                                    |

## Rendered verification and limits

The layout revision records source intent and a verification plan. It does not
claim that new application renders or checks have passed. Results must identify
the source actually exercised after the current edits are frozen.

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

## Historical canonical screenshot evidence

The following evidence belongs to the earlier PR482 source. It does not validate
the current layout revision or establish its new visual baselines.

Canonical Linux phone screenshots use the reviewed GitHub Actions captures from
source `ce434be01f34400ccf19aa2668757e33945378bc` (auth artifact `12816691913`;
quality artifact `12817610103`). That environment installs the pinned Playwright
browser and its Ubuntu font dependencies. The local environment renders the same
font stacks with DejaVu Serif/Sans; the CI greeting fits on one line while the
local greeting wraps to two. Both layouts were inspected for containment and
control alignment. Only the three affected canonical phone PNGs were accepted;
snapshot tolerances and interaction assertions remain unchanged.
