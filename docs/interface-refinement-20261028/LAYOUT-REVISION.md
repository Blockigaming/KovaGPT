# Kova layout revision

The latest owner direction assigns Projects organization to Google Drive;
page layout, controls, popups and theme presentation to ChatGPT; simplicity to
Gemini/Grok; and interface/reading type roles plus contextual content to Claude.
Kova retains its supplied identity and existing product behavior. This revision
supersedes broad serif styling of management and dialog headings in the earlier
[design contract](../interface-refinement-20261027/DESIGN.md).

## Inspected official references

Public source pages and their published image assets were retrieved and their
pixels inspected on 2026-10-28 UTC. Firecrawl's design workflow was read, but its
initial searches did not execute because the connected account had insufficient
credits. Official web retrieval supplied the references below. No private
account, sign-in or production personal data was used.

| Official source                                                                                                                                                 | Inspected evidence and limits                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Google Drive product page](https://workspace.google.com/intl/en/products/drive/)                                                                               | Current public marketing page and its project/search illustrations. These are composed product illustrations, not a full working Drive session or a source of exact interface geometry.                                                                                                                 |
| [Google Workspace: unified file and folder suggestions](https://workspaceupdates.googleblog.com/2024/08/unified-view-file-folder-suggestions-google-drive.html) | Published 2024-09-05; its 800 × 489 Home image shows left navigation, search/filter controls, a suggested-folder row and a flat file list with metadata and trailing menus. The historical image does not establish every current account state.                                                        |
| [Drive: view and reorder files and folders](https://support.google.com/drive/answer/2375177?hl=en)                                                              | Current help text corroborates list/grid switching, sorting and an optional folders-first presentation. Text establishes behavior, not pixel dimensions.                                                                                                                                                |
| [Drive: organize files](https://support.google.com/drive/answer/2375091?hl=en)                                                                                  | Supports clear folder organization and contextual item actions. Kova does not gain Drive storage behavior or new server operations from this visual reference.                                                                                                                                          |
| [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)                                                                            | Inspected published sidebar, project-menu and project-list images: 450 × 268, 1344 × 297 and 1180 × 948. They show icon/name navigation, a compact header, a rounded composer and flat saved-chat rows. Some images are crops or promotional compositions.                                              |
| [ChatGPT visual experience](https://help.openai.com/en/articles/11958281-updating-your-visual-experience-on-chatgpt)                                            | Inspected the 834 × 659 desktop General-settings image with its accent menu open. It shows category navigation, simple divided settings rows and an anchored rounded menu with a selected row/check. Available options vary by platform/account; the image does not justify adding settings Kova lacks. |

The earlier contract retains the inspected public Grok/x.ai and Claude evidence,
including its recorded 1363 × 936 viewport. Those captures support quiet surfaces
and separate sans interface/serif content roles. No fresh Gemini capture was
obtained in this revision: “Gemini/Grok simplicity” is the owner's design
direction, not a claim of measured Gemini tokens. The new reference images
establish only their shown desktop/light states. They do not establish mobile
layout, dark-theme colors, hover, animation, keyboard behavior or exact CSS.

## Chosen Kova patterns

### Shared page organization and controls

Use the existing shell around a concise title, optional description and compact
action group. Place search, filters and view controls next to the collection
they affect. Prefer simple rows and readable columns to repeated nested cards.
Keep primary and secondary actions visually distinct, with rounded buttons and
consistent outline glyphs. Anchored menus use compact rounded rows, a clear
selected state and restrained elevation. Dialogs retain meaningful headings,
descriptions, internal scrolling, Escape behavior and return focus. Fullscreen
media and navigation drawers keep their own geometry.

### Projects directory and detail

`src/routes/projects.tsx` scopes the directory with `.kova-project-directory`.
Its `.kova-project-directory-tools`, search and toolbar hooks group existing
search/filter/sort/list-grid controls. Project entries use folder icons, a
readable name, concise metadata and a trailing action menu. The list presents
aligned columns; the grid keeps the same information hierarchy. Invitations,
pinned projects, archived content, loading, empty and error states retain their
actual meaning and actions.

`src/routes/projects.$projectId.tsx` uses `.kova-project-workspace` and a compact
breadcrumb/header/action group. Chats, Files and Context are the primary tabs;
the existing secondary tools remain reachable. Files and chats use quiet
resource rows rather than decorative dashboard tiles. Context keeps project
instructions and supporting material together. Role, sharing, archive and
permission messages remain visible. The files/detail hierarchy is a Kova choice
informed by Drive organization and ChatGPT page structure, not a claim that
either product exposes these exact tabs.

### Settings and appearance

Use shared neutral surfaces, category navigation and simple divided rows. Align
labels and helper text on one side with their existing controls on the other;
let narrow layouts stack without clipping. Appearance selectors and their menus
share the control/popup treatment. Theme colors, focus, selected, destructive
and disabled states must remain readable. Keep Kova's existing appearance
options, persistence, availability and account behavior; reference screenshots
do not authorize new settings or defaults.

### Typography and contextual content

System sans is the default UI role, including navigation, management page titles,
dialog headings, labels, tabs, tables, metadata and compact empty states.
`--font-ui`, `--font-sans` and `--font-display` share that interface role.
`--font-reading` is a separate Georgia fallback for explicitly scoped greetings,
assistant reading and editorial content. A heading does not become serif merely
because it is an `h1` or `h2`. Content pages can retain editorial hierarchy while
their navigation, forms and data stay sans. Code, preformatted text and
structured editors retain monospace. Proprietary reference fonts are not
redistributed or claimed to be installed.

### Simplicity and dimensions

Use concise supporting text, restrained borders/shadows and a clear action
hierarchy without removing useful controls or truthful states. Existing Kova
choices such as 44px interaction targets, 20px glyphs, 8/12/16/24px spacing,
bounded reading columns and shared corner-radius tokens are implementation
choices. They are not measurements of every reference product.

## Continued control and spacing refinement

Visible choice controls now use the shared Select component across workspace,
composer, appearance, image, study, scheduled-task, work, organization,
developer, writing and generated-content surfaces. Existing values, parsers,
disabled states, access checks and submission handlers remain authoritative.
Empty associations map to an internal menu value and back to their existing
empty or null state; that menu value is not sent to the server. The searchable
picker retains its hidden native select as a compatibility bridge; its visible
searchable popup remains the shared interface.

Kovas, Study, Prompt Studio and Context Packs use shared confirmation dialogs
instead of browser confirmation boxes. Kovas reporting uses the shared text
entry dialog. Deferred confirmations check their original principal and
resource/configuration lifetime before acting, consume approval once, and
restore keyboard focus. Prompt/context deletion also exposes a pending state,
disables competing delete controls and focuses the saved-list heading after
the deleted trigger disappears.

The Work evidence timeline uses the shared slider for two or more events,
retaining its event-index range and step. Zero or one event keeps its timestamp
label without presenting an inert range. Appearance's reading sample explicitly
uses the reading font; its controls retain the interface font.

The earlier global page rules no longer force every workspace to 1200px with
32px padding. Shared defaults consume the page variables. The Projects directory
owns its 1280px maximum, desktop responsive gutters and 16px phone gutters;
Library, Settings and generic workspace pages retain their respective layout
owners. These dimensions are Kova implementation choices, not measured claims
about the reference products.

## Verification status

This document records source intent and inspected external evidence. It does
not report new application test passes, rendered coverage or baseline approval.
After source freeze, review phone/tablet/desktop light and dark layouts, Projects
list/grid and detail tabs, settings rows, dialogs, long menus, keyboard focus,
safe areas and overflow. Preserve existing semantic, permission and navigation
assertions. New screenshots require inspection before acceptance.

The finite 78-template/13-family inventory remains anchored to its recorded
base source in [REFERENCE-COVERAGE.md](./REFERENCE-COVERAGE.md); it is not a
visual-completion percentage. Earlier canonical phone captures remain historical
evidence for their exact source and are not proof of this layout revision.
