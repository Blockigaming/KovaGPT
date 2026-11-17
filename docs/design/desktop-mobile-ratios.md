# Desktop → mobile interface relationships

Measured November 17, 2026. Status: reference audit in progress; no product styles changed by this audit.

## Owner direction

Keep Kova's desktop design, sections, content, controls, and feature access. Establish how the reference interface changes between desktop and a narrow viewport, then apply the equivalent relationship to Kova. A smaller screen is not a reason to redesign a section or shrink every element by one percentage.

For a comparable scalar property:

`ratio = reference narrow value / reference desktop value`

`Kova narrow target = Kova desktop value × ratio`

For structural changes, apply the behavior instead: fewer columns, a toolbar wrapping, a sidebar becoming an overlay, or a dialog filling the viewport. A width measured at one viewport is not a universal percentage.

Example: the reference home heading is 24 px at both measured widths, so its font-size ratio is 1. If Kova's rendered desktop heading is 32 px, the equivalent narrow heading is 32 px. Copying the reference's absolute 24 px would change Kova's design.

## Evidence and limits

- Reference: the signed-in ChatGPT **web** interface observed in this session, not an official design specification and not the native iOS/Android applications.
- Desktop CSS viewport: 1363 × 936, 100% browser zoom, device-pixel ratio 1.
- Narrow CSS viewports: approximately 454.33 × 312 at 300% zoom and 340.75 × 234 at 400% zoom. `innerWidth` rounds these to 454 and 340. Browser zoom was restored to 100% afterward.
- The narrow observations verify responsive width rules, wrapping, and computed CSS values. They do **not** emulate a touch pointer, a tall phone viewport, a software keyboard, device safe areas, or mobile browser chrome. Vertical placement at these short heights must not be treated as a portrait-phone measurement.
- Response measurements came from a fresh temporary conversation containing fictional sample text, a list, a table, code, a blockquote, and inline math. Existing conversation contents were not used. No account identifiers, library filenames, or personal content are included here.
- The separate `ChatGPT_Response_Interface_Specification.md` is a proposed reference design, not a source of measured pixels. Its proposed values are not silently substituted for observations.
- Kova source baseline: `2e062bd207dda195f15b34d94e920f2778c1cac1`. Source values below remain provisional until confirmed by computed styles; imports and selector precedence matter.
- Local Chromium could not launch because the environment disallowed a required socket. An escalation request was rejected by environment policy. The measurement suite is prepared for the repository's standard GitHub Actions environment; this is not a passing local browser result.

## Reference measurements

Values are CSS pixels unless otherwise stated. Ratios are narrow ÷ desktop. “Same” refers only to the sampled state. Control geometry below is from a fine-pointer browser; retain Kova's 44 px touch targets independently of visible icon geometry.

| Component/property                 | Desktop                                         | Narrow observation                      | Relationship for Kova                                                                                       |
| ---------------------------------- | ----------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Main canvas                        | 1023 with sidebar docked                        | Full viewport width                     | Reclaim sidebar space, then apply content gutters                                                           |
| Reading/composer maximum width     | 768                                             | Available width minus gutters           | Keep Kova's desktop cap; use `min(cap, available width)`                                                    |
| Header height                      | 52                                              | 52                                      | 1.00; safe-area space is separate                                                                           |
| Home heading font                  | 24                                              | 24                                      | 1.00                                                                                                        |
| Home heading line height           | 28.8                                            | 28.8                                    | 1.00                                                                                                        |
| Home heading alignment             | Center                                          | Center                                  | Preserve alignment in the sampled state                                                                     |
| Empty home composer                | 768 × 52                                        | 419 × 87 at 454                         | One row becomes two; do not multiply an already stacked Kova composer by 87/52                              |
| Composer at 340                    | Desktop cap 768                                 | 308.75 wide                             | Approximately 16 px outer gutters; width is a constraint, not a fixed ratio                                 |
| Composer text                      | 16 / 26 line height                             | 16 / 26                                 | 1.00 for both                                                                                               |
| Narrow composer text row           | Embedded in one row                             | 43 high                                 | Separate input row; 11 top, 14 right, 6 bottom, 15 left padding                                             |
| Composer footer                    | 8 padding, 8 gap                                | 0 top, 8 sides/bottom, 8 gap            | Retain control spacing; move controls to their own row                                                      |
| Empty home composer radius         | 26                                              | 28                                      | 1.077 for this particular shell/state                                                                       |
| Conversation composer outer radius | 28                                              | 28                                      | 1.00; measure outer shell, not inner body with radius 0                                                     |
| Add, dictate, voice controls       | 36 × 36                                         | 36 × 36                                 | 1.00 visible control geometry; touch target minimum remains separate                                        |
| Composer model trigger height      | 36                                              | 36                                      | 1.00                                                                                                        |
| Composer model text                | 16 / 26                                         | 16 / 26                                 | 1.00                                                                                                        |
| Model-trigger horizontal padding   | 16 left, 12 right                               | Same                                    | 1.00                                                                                                        |
| Model menu                         | 254 × 84                                        | 254 × 84                                | Keep intrinsic menu size when it fits; clamp to available space                                             |
| Model menu radius                  | 16                                              | 16                                      | 1.00                                                                                                        |
| Model menu placement               | Anchored popover                                | Can flip above trigger                  | Collision handling, not a different design                                                                  |
| Effort-slider thumb                | 28 × 28                                         | 28 × 28                                 | 1.00                                                                                                        |
| Attachment menu width              | Composer-wide, 768                              | Composer-wide in narrow view            | Tie width to composer; bound height and scroll internally                                                   |
| Attachment menu rows               | 36 high; 14 / 20 text                           | Same sampled row metrics                | 1.00; preserve touch target policy                                                                          |
| Attachment menu row padding/radius | 6 vertical, 8 horizontal; radius 12             | Same sampled row metrics                | 1.00                                                                                                        |
| Primary sidebar                    | 340 wide, docked                                | 260 wide, overlay                       | Width ratio 0.765 for the sampled reference; overlay behavior matters more than applying that width blindly |
| Sidebar row                        | 35 high; 14 / 20 text                           | Same                                    | 1.00 fine-pointer metrics; phone hit targets need separate verification                                     |
| Sidebar row padding/gap/radius     | 6 vertical, 10 horizontal; gap 8; radius 8      | Same                                    | 1.00                                                                                                        |
| Sidebar profile row                | 52 high                                         | 52 high                                 | 1.00                                                                                                        |
| Search dialog                      | 720 × 460, centered, radius 16                  | Full 454.33 × 312 viewport, radius 0    | Fullscreen search surface at narrow widths                                                                  |
| Search dialog header               | 65 high                                         | 65 high                                 | 1.00                                                                                                        |
| Search close button                | 36 × 36                                         | 36 × 36                                 | 1.00 visual geometry                                                                                        |
| Settings section content           | 768 wide                                        | 411 at 454, approximately 20 px gutters | Fluid content with gutters                                                                                  |
| Settings heading                   | 24 / 28.8                                       | 24 / 28.8                               | 1.00                                                                                                        |
| Settings edit controls             | 36 high                                         | 36 high                                 | 1.00 visual geometry                                                                                        |
| Library heading                    | 24 / 28.8                                       | 24 / 28.8                               | 1.00                                                                                                        |
| Library toolbar                    | One horizontal row                              | Wraps to two rows                       | Reflow without scaling controls                                                                             |
| Library filter tabs                | 36 high; 14 / 20 text; 16 horizontal padding    | Same                                    | 1.00; overflow is horizontal scrolling                                                                      |
| Library tab gap                    | 4                                               | 4                                       | 1.00                                                                                                        |
| Library grid                       | Four columns, 217 wide each                     | One column, approximately 355 wide      | Column-count change; a phone card can be wider than a desktop card                                          |
| Library grid gap/radius            | Gap 16; radius 16                               | Same                                    | 1.00                                                                                                        |
| Sample library card                | 217 × 270.75                                    | 355 × 443.25                            | Preserve aspect ratio, not fixed height                                                                     |
| Library page gutter                | Approximately 48                                | Approximately 48 in observed layout     | Do not assume every page uses the chat's 16 px gutters                                                      |
| Connections catalog grid           | Two columns, 448 wide; 24 column gap, 8 row gap | One 411-wide card column at 454         | Reflow columns, retain card internals                                                                       |
| Connections catalog card           | 64.75 high; padding 8; radius 16                | Same height, padding and radius         | 1.00 for these sampled cards                                                                                |
| Catalog install button             | 36 × 36                                         | 36 × 36                                 | 1.00 visible geometry                                                                                       |
| Catalog title/section heading      | 24 / 28.8 and 18 / 24                           | Same                                    | 1.00                                                                                                        |
| Catalog search input text          | 16 / 18                                         | 16 / 18                                 | 1.00; input width grows from 192 to 363 as toolbar wraps                                                    |
| Response body                      | 16 / 26                                         | 16 / 26 at both narrow widths           | 1.00                                                                                                        |
| Response H2                        | 18 / 28                                         | 18 / 28                                 | 1.00                                                                                                        |
| First paragraph margin             | 8 top                                           | 8 top                                   | 1.00                                                                                                        |
| Subsequent paragraph margin        | 16 top                                          | 16 top                                  | 1.00                                                                                                        |
| Sample paragraph height            | 52, two lines                                   | 78 at 454; 104 at 340                   | Height follows wrapping; never force a height ratio                                                         |
| Bullet-list indentation            | 32 left; item padding 4, margin-left -4         | Same                                    | 1.00                                                                                                        |
| Table cell text                    | 14 / 20                                         | 14 / 20                                 | 1.00                                                                                                        |
| Table cell padding                 | 8                                               | 8                                       | 1.00; the short sample table fit, wide-table behavior needs separate verification                           |
| Code text                          | 12 / 20                                         | 12 / 20                                 | 1.00                                                                                                        |
| Code horizontal padding            | 20                                              | 16                                      | 0.80                                                                                                        |
| Code bottom padding                | 12                                              | 12                                      | 1.00                                                                                                        |
| Long code line                     | Content wider than reading column               | Content wider than reading column       | Internal horizontal scrollport; page must not overflow                                                      |
| Blockquote indentation/margin      | 16 left; 16 top margin                          | Same                                    | 1.00; height follows wrapping                                                                               |
| User/assistant message actions     | 32 × 32                                         | 32 × 32                                 | 1.00 visible geometry; touch hit regions still need verification                                            |
| Code copy/wrap controls            | 36 high                                         | 36 high                                 | 1.00                                                                                                        |
| Jump-to-latest control             | 32 × 32                                         | 32 × 32                                 | 1.00 visible geometry                                                                                       |
| Bottom navigation                  | Absent                                          | Absent in sampled web layout            | No direct equivalent for Kova's existing bottom tabs; do not delete features based on this observation      |

## Mapping to Kova's existing implementation

These are audit findings and candidate mappings, not deployed changes. The desktop source and page sections remain untouched.

| Kova component                  | Current source behavior                                                                                                                                                  | Equivalent relationship / next check                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty-chat greeting             | Active desktop rule is 32 px, reading font, weight 400, line-height 1.2, centered. Last phone override is 28–38 px, UI font, weight 600, line-height 1.1, start-aligned. | Reference font-size ratio is 1. Verify computed styles, then retain Kova desktop typography/alignment on phone. The earlier assumption that the phone rule simply enlarged the heading was incomplete. |
| Empty-chat composer             | Desktop starts with a stacked 148 px minimum; phone removes the minimum and uses a compact two-row layout.                                                               | Do not apply the reference's 1→2-row height ratio to this already stacked desktop component. Measure input row, toolbar row, gaps, and padding separately.                                             |
| Empty composer corner           | Desktop token is 26; phone override is 21.                                                                                                                               | Verify visible outer border. The reference gets slightly rounder or stays the same, not sharply less rounded.                                                                                          |
| Input text                      | Source uses 16 / 26.                                                                                                                                                     | Keep the 1.00 text/line-height relationship; assert the computed values.                                                                                                                               |
| Primary voice/send              | Desktop source is 43; coarse/narrow source is 44.                                                                                                                        | Preserve 44 px touch target. Keep icon size independent from target size.                                                                                                                              |
| Workspace titles                | Desktop source uses `--page-title-size` (default 30); older narrow rule sets 24; final phone rule clamps 26–34.                                                          | Verify active computed value. Equivalent reference relationship is 1.00, not viewport-dependent type scaling.                                                                                          |
| Library tabs                    | Phone overrides introduce a framed wrapping group and expanding buttons.                                                                                                 | Reference retains tab sizes and uses horizontal overflow. Measure Kova's desktop tab shape first; keep labels and categories.                                                                          |
| Library cards                   | Phone already collapses columns.                                                                                                                                         | Confirm card aspect ratio, spacing, and title typography without changing resources or categories.                                                                                                     |
| Connections cards               | Phone overrides change desktop card layout into multiple named grid rows.                                                                                                | Verify whether changing only column count and wrapping is enough. Preserve logos, descriptions, availability labels, and actions.                                                                      |
| Sidebar                         | Kova has a docked sidebar and a `min(86vw, 320px)` overlay drawer with 44 px targets.                                                                                    | Overlay relationship already exists. Compare actual desktop width and usable drawer width before any numerical change; do not reduce legibility by blindly applying 0.765.                             |
| Search and other dialogs        | Existing mobile shell tests cover clipping and focus restoration.                                                                                                        | Search can follow the measured fullscreen behavior. Other dialog families need their own evidence; do not turn every popover into fullscreen search.                                                   |
| Transcript, lists, tables, code | Several imported style layers affect the result.                                                                                                                         | Measure computed styles; retain desktop font/line relationships and local overflow behavior.                                                                                                           |
| Phone navigation                | Four existing destinations and keyboard-aware behavior.                                                                                                                  | No direct reference equivalent. Keep the section/destination inventory until a specific replacement is established.                                                                                    |
| Public marketing/auth pages     | Separate page structure and typography.                                                                                                                                  | Out of this interface-ratio implementation. The owner's existing sections/design are frozen.                                                                                                           |

`src/styles/assistant.css` is not imported by the active stylesheet entry. Do not use its historical values as the desktop baseline. Relevant active layers include `spec400-chat.css`, `visual-tokens.css`, `workspace-layout.css`, `app-finish.css`, and finally `phone-layout.css`.

## Remaining evidence needed before “every difference” is complete

This is an explicit open inventory, not an assertion that all interface states have been verified.

| Family                   | Unverified states/properties                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual phone environment | Tall portrait layout, touch/coarse pointer, native font scaling, browser bars, safe areas, software keyboard, orientation changes                                                  |
| Breakpoints              | Exact transition thresholds, intermediate widths, tablet split behavior, short versus tall windows                                                                                 |
| Shell                    | Work-mode layout, collapsed desktop rail, side panels, temporary-state banners, unread badges, account switching                                                                   |
| Typography               | H1/H3–H6 inside responses, inline math geometry, links, citations, footnotes, fallback fonts, text selection                                                                       |
| Composer                 | Multiline growth and limit, attachment thumbnails, drag/drop, quoted selections, project tokens, token overflow, dictation, recording, sending, stop, retry, disabled/error states |
| Response states          | Streaming, thinking/activity panels, tool progress, errors, regeneration, edit mode, branching, branch navigation, follow-up suggestions                                           |
| Rich outputs             | Wide/dense tables, image generation, galleries, charts, interactive forms, maps, audio/video players, file previews, artifacts, canvas, download menus                             |
| Navigation actions       | Chat context menu, rename/archive/delete confirmation, project selection, project creation/settings, share dialog, shared-chat views                                               |
| Catalog/library          | Search empty/error states, filtering, list view, selection/bulk actions, upload progress, preview/viewer, connected versus unavailable actions                                     |
| Settings                 | Every section, nested dialogs, destructive-action confirmations, billing/upgrade, security flows, long labels and validation errors                                                |
| Visual states            | Both themes, exact colors, border/shadow changes, hover/pressed/focus/disabled states, animation timing, reduced-motion behavior                                                   |
| Accessibility            | Real touch-target hit regions, keyboard traversal, focus restoration, screen reader announcements, zoom/text-size stress                                                           |

No percentage of “everything” is meaningful until this finite inventory is agreed and each state has evidence. A passed page-overflow check alone does not establish visual parity.

## Reproducible Kova measurement

The audit opens eight real routed states with synthetic service/account data at desktop 1440 × 900 and touch viewports 320 × 700, 390 × 844, and 430 × 932. It waits for hydration and fonts, saves computed geometry and fixture screenshots, and fails on client exceptions or page overflow. It does not sign into production, invoke AI services, or alter styles.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:azure
bash scripts/ci/install-playwright-browsers.sh chromium
npx playwright test --config=playwright.interface-ratio.config.ts
```

Artifacts: `test-results/interface-ratio/**/geometry.json`, `layout.png`, and exact source `commit.txt`. These are baseline evidence, not assertions that reference matching has been implemented. Any later mobile-only correction must compare the desktop measurements before/after and confirm that the page sections and controls remain present.
