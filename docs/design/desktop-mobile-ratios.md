# Desktop → mobile interface relationships

Measured November 17, 2026. Status: mobile equivalence implemented. The corrected page geometry and mobile interactions have passed; exact revision checks are linked below and on PR #717. The frozen desktop baseline passed 32/32 checks before these corrections.

## Owner direction

Keep Kova's desktop design, sections, content, controls, and feature access. Establish how the reference interface changes between desktop and a narrow viewport, then apply the equivalent relationship to Kova. A smaller screen is not a reason to redesign a section or shrink every element by one percentage.

For a comparable scalar property:

`ratio = reference narrow value / reference desktop value`

`Kova narrow target = Kova desktop value × ratio`

For structural changes, apply the behavior instead: fewer columns, a toolbar wrapping, a sidebar becoming an overlay, or a dialog filling the viewport. A width measured at one viewport is not a universal percentage.

Example: the reference home heading is 24 px at both measured widths, so its font-size ratio is 1. If Kova's rendered desktop heading is 32 px, the equivalent narrow heading is 32 px. Copying the reference's absolute 24 px would change Kova's design. Keep accessibility constraints separate: a smaller reference control is not permission to reduce Kova's 44 px touch targets, and editable mobile fields must retain their legibility and keyboard behavior.

## Implemented mobile transformations

All product changes are scoped to phone widths below 768 px and short coarse-pointer viewports below 1024 px. Desktop remains the source of Kova's visual design. `phone-equivalence.css` resolves the later overrides that previously redesigned mobile components. The other interface behaviors already present—overlay navigation, reflowed toolbars, local scrolling, keyboard-aware composer, and fullscreen search—remain part of the verification suite.

| Correspondence                  | Reference desktop → narrow                                        | Kova implementation                                                                                          |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Home greeting                   | Type, weight, family and alignment retained                       | Keep Kova's 32/38.4 serif heading, weight 400, centered                                                      |
| Stacked home / Work composer    | Text area 52 → 26; padding 15/18/16 and radius 28 unchanged       | Text area 68 → 34; Kova padding 16 and radius 34 retained                                                    |
| Stacked composer total height   | 127 → 101 (0.795)                                                 | Approximately 165 → 132 (0.800); the 44 px phone control minimum accounts for the difference                 |
| Conversation composer           | One row → two, readable type and corners retained                 | Existing two-row phone structure retained; no aggregate height multiplier                                    |
| Header                          | 52 → 52                                                           | Kova 64 → 64, plus device safe area                                                                          |
| Navigation                      | Docked 340 → overlay 260                                          | Multiply the configured Kova rail width by 13/17, clamp to viewport, retain 44 px targets                    |
| Model menu                      | Intrinsic width and radius unchanged, collision-aware positioning | Kova 282 px / 18 px retained; viewport clamp and internal scrolling                                          |
| Response text, lists and quotes | Same typography, spacing and indentation                          | Restore 16/28 body, desktop heading scale, list and quote indentation                                        |
| Code horizontal inset           | 20 → 16 (0.8)                                                     | Kova 16 → 12.8; text size, vertical inset and local scrolling retained                                       |
| Page headings                   | Type retained                                                     | Kova's 28/36 management, 30/37.5 catalog, 32/38 Images, 28/33.6 Settings headings                            |
| Library                         | Toolbar reflows; tabs scroll; card grid loses columns             | Keep 14/20 tabs, 8 px gaps, 12 px tab insets, round pills, 32 px page gutters; remove extra phone-only frame |
| Connections                     | Fewer columns, same card internals                                | One column; retain Kova padding 16, radius 22, gap 10 and footer controls                                    |

### Matching the composer state

The initial compact **Chat** reference (52 → 87 px) is not the corresponding state for Kova's stacked home composer. A subsequent signed-in **Work** measurement at the same desktop and narrow widths found:

| Work property         | Desktop                     | Narrow    | Ratio                                   |
| --------------------- | --------------------------- | --------- | --------------------------------------- |
| Outer composer        | 768 × 127                   | 419 × 101 | Height 0.795                            |
| Input wrapper         | 768 × 83                    | 419 × 57  | Height follows input plus fixed padding |
| Editable text area    | 732 × 52                    | 383 × 26  | Height 0.5                              |
| Input wrapper padding | 15 top, 18 sides, 16 bottom | Same      | 1                                       |
| Outer radius          | 28                          | 28        | 1                                       |
| Input text            | 16/26                       | 16/26     | 1                                       |
| Heading               | 24/28.8                     | 24/28.8   | 1                                       |

Only corresponding properties are multiplied. Available width, wrapped text height, and row counts are layout constraints. Kova's existing phone destinations are retained when there is no direct reference counterpart. Browser-zoom observations do not establish portrait-phone vertical placement or real keyboard acceptance.

## Evidence and limits

- Reference: the signed-in ChatGPT **web** interface observed in this session, not an official design specification and not the native iOS/Android applications.
- Desktop CSS viewport: 1363 × 936, 100% browser zoom, device-pixel ratio 1.
- Narrow CSS viewports: approximately 454.33 × 312 at 300% zoom and 340.75 × 234 at 400% zoom. `innerWidth` rounds these to 454 and 340. Browser zoom was restored to 100% afterward.
- The narrow observations verify responsive width rules, wrapping, and computed CSS values. They do **not** emulate a touch pointer, a tall phone viewport, a software keyboard, device safe areas, or mobile browser chrome. Vertical placement at these short heights must not be treated as a portrait-phone measurement.
- Response measurements came from a fresh temporary conversation containing fictional sample text, a list, a table, code, a blockquote, and inline math. Existing conversation contents were not used. No account identifiers, library filenames, or personal content are included here.
- The separate `ChatGPT_Response_Interface_Specification.md` is a proposed reference design, not a source of measured pixels. Its proposed values are not silently substituted for observations.
- Kova source baseline: `2e062bd207dda195f15b34d94e920f2778c1cac1`. Source values below remain provisional until confirmed by computed styles; imports and selector precedence matter.
- Local Chromium could not launch because the environment disallowed a required socket. An escalation request was rejected by environment policy. The measurement suite subsequently passed in the repository's standard GitHub Actions environment on Ubuntu 24.04; this is not a passing local browser result.

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

The following records the pre-correction source audit. Implemented changes are listed above; this historical table is not the current acceptance result.

| Kova component                  | Current source behavior                                                                                                                                                                         | Equivalent relationship / next check                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty-chat greeting             | Active desktop rule is 32 px, reading font, weight 400, line-height 1.2, centered. Last phone override is 28–38 px, UI font, weight 600, line-height 1.1, start-aligned.                        | Reference font-size ratio is 1. Verify computed styles, then retain Kova desktop typography/alignment on phone. The earlier assumption that the phone rule simply enlarged the heading was incomplete. |
| Empty-chat composer             | Earlier rules set a stacked 148 px minimum. Later `app-finish.css` sets 156 px minimum and a 68 px input minimum with `!important`; the phone 0/36 px rules do not override those declarations. | Measure the winning layout before changing it. Treat input row, toolbar, padding, and gap separately; never multiply an already stacked desktop composer by 87/52.                                     |
| Empty composer corner           | Base token is 26; `app-finish.css` sets the composer variable to 34; the phone empty-composer rule sets it to 21.                                                                               | Confirm the outer border and variable inheritance. Reference rounding stays similar across widths, so this large reduction is a candidate mismatch.                                                    |
| Input text                      | Base source is 16 / 26; `app-finish.css` applies 16 with line-height 1.55 (24.8) using `!important`.                                                                                            | Keep the 1.00 desktop-to-phone text/line relationship using the winning Kova values, not an obsolete source rule.                                                                                      |
| Primary voice/send              | Desktop source is 43; coarse/narrow source is 44.                                                                                                                                               | Preserve 44 px touch target. Keep icon size independent from target size.                                                                                                                              |
| Workspace titles                | Desktop source uses `--page-title-size` (default 30); older narrow rule sets 24; final phone rule clamps 26–34.                                                                                 | Verify active computed value. Equivalent reference relationship is 1.00, not viewport-dependent type scaling.                                                                                          |
| Library tabs                    | Phone overrides introduce a framed wrapping group and expanding buttons.                                                                                                                        | Reference retains tab sizes and uses horizontal overflow. Measure Kova's desktop tab shape first; keep labels and categories.                                                                          |
| Library cards                   | Phone already collapses columns.                                                                                                                                                                | Confirm card aspect ratio, spacing, and title typography without changing resources or categories.                                                                                                     |
| Connections cards               | Phone overrides change desktop card layout into multiple named grid rows.                                                                                                                       | Verify whether changing only column count and wrapping is enough. Preserve logos, descriptions, availability labels, and actions.                                                                      |
| Sidebar                         | Kova has a docked sidebar and a `min(86vw, 320px)` overlay drawer with 44 px targets.                                                                                                           | Overlay relationship already exists. Compare actual desktop width and usable drawer width before any numerical change; do not reduce legibility by blindly applying 0.765.                             |
| Search and other dialogs        | Existing mobile shell tests cover clipping and focus restoration.                                                                                                                               | Search can follow the measured fullscreen behavior. Other dialog families need their own evidence; do not turn every popover into fullscreen search.                                                   |
| Transcript, lists, tables, code | Several imported style layers affect the result.                                                                                                                                                | Measure computed styles; retain desktop font/line relationships and local overflow behavior.                                                                                                           |
| Phone navigation                | Four existing destinations and keyboard-aware behavior.                                                                                                                                         | No direct reference equivalent. Keep the section/destination inventory until a specific replacement is established.                                                                                    |
| Public marketing/auth pages     | Separate page structure and typography.                                                                                                                                                         | Out of this interface-ratio implementation. The owner's existing sections/design are frozen.                                                                                                           |

`src/styles/assistant.css` is not imported by the active stylesheet entry. Do not use its historical values as the desktop baseline. Relevant active layers include `spec400-chat.css`, `visual-tokens.css`, `workspace-layout.css`, `app-finish.css`, `phone-layout.css`, and the mobile-only `phone-equivalence.css`.

## Rendered Kova baseline: 32/32 passed

[Measurement run](https://github.com/Blockigaming/KovaGPT/actions/runs/44191472210), source `9685cb0094f7488c5964f9b286214fa0cdd35359`. The application build and all 32 measurements passed. Eight states were checked at each of four viewports; all reported zero document overflow and no client exceptions. This proves baseline rendering and captures differences; it does not prove reference matching.

The original audit attempt built successfully but could not install Playwright 1.56 on the new Ubuntu 26.04 `ubuntu-latest` runner. The audit runner was pinned to Ubuntu 24.04, then the unchanged browser assertions passed. No application code or check was removed to obtain that result.

| Kova property                   | Desktop 1440       | Phone 390                           | Phone ÷ desktop         | Interpretation                                                                                                              |
| ------------------------------- | ------------------ | ----------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Greeting font size              | 32                 | 28                                  | 0.875                   | Reference stays at 1.00. Candidate target: retain Kova's 32.                                                                |
| Greeting line height            | 38.4               | 30.8                                | 0.802                   | Reference stays at 1.00. Candidate target: retain 38.4.                                                                     |
| Greeting font/weight            | Reading serif, 400 | UI sans-serif, 600                  | Categorical change      | A design change has been introduced on phone, beyond responsive sizing.                                                     |
| Empty composer width            | 768                | 358.81                              | 0.467                   | Width correctly follows available canvas; do not apply this ratio to text or controls.                                      |
| Empty composer height           | 165                | 156                                 | 0.945                   | Remains tall on all three phone widths; inspect its constituent rows instead of copying the reference's total-height ratio. |
| Empty composer text area height | 68                 | 68                                  | 1.00                    | The later forced minimum wins over the intended compact phone row.                                                          |
| Empty composer corner           | 34                 | 21                                  | 0.618                   | Much sharper on phone; unlike the sampled reference transformation.                                                         |
| Empty composer padding          | 16                 | 12                                  | 0.75                    | Consider together with row sizing and touch controls.                                                                       |
| Composer text / line height     | 16 / 24.8          | 16 / 24.8                           | 1.00 / 1.00             | Already preserves the observed reference relationship.                                                                      |
| Conversation composer height    | 57                 | 86                                  | 1.509                   | Correct structural direction: one desktop row becomes two phone rows.                                                       |
| Conversation composer corner    | 34                 | 34                                  | 1.00                    | Already preserves the observed reference relationship.                                                                      |
| Primary voice target            | 43 × 43            | 44 × 44                             | 1.023                   | Preserve the deliberate touch-target minimum.                                                                               |
| Assistant body font size        | 16                 | 16                                  | 1.00                    | Already preserves the observed relationship.                                                                                |
| Assistant body line height      | 28                 | 24                                  | 0.857                   | Reference stays at 1.00. Candidate target: retain Kova's 28.                                                                |
| Library tab text                | 14                 | 13                                  | 0.929                   | Reference stays at 1.00. Candidate target: retain 14.                                                                       |
| Library tab line height         | 20                 | 18.57                               | 0.929                   | Reference stays at 1.00. Candidate target: retain 20.                                                                       |
| Library tab height              | 44                 | 44                                  | 1.00                    | Keep the existing usable target.                                                                                            |
| Library tab horizontal padding  | 12                 | 16                                  | 1.333                   | Reference padding stays constant. Review alongside the phone filter container.                                              |
| Library filter group            | 44 high, no frame  | 53 high, padding 4, radius 16 frame | Structural/style change | The phone rule adds a group treatment absent from the desktop design.                                                       |
| Connections card padding        | 16                 | 12                                  | 0.75                    | Reference sample retains padding. Review Kova card structure before applying a numerical target.                            |
| Connections card radius         | 22                 | 16                                  | 0.727                   | Reference sample retains radius.                                                                                            |
| Connections card height         | 184                | 122                                 | 0.663                   | Its internal grid changes; height cannot be evaluated independently of content wrapping.                                    |
| Chat header height              | 64                 | 53                                  | 0.828                   | Reference header height stays constant, but Kova's differing header structures need a like-for-like control comparison.     |
| Bottom navigation               | Absent             | 57 high                             | Additional surface      | Preserve its destinations; there is no direct reference web equivalent.                                                     |

Phone-width sweep: the empty composer remained 156 px high with a 68 px text area at 320, 390, and 430 px. The greeting was 28 px at 320/390 and 30.1 px at 430, confirming viewport-dependent type scaling rather than a constant relationship.

Visual inspection of the baseline desktop home, phone home, and phone Library captures confirms these are real rendered states. Library and Connections move their visible title into the phone top bar; their in-content H1 becomes a 1 × 1 screen-reader-only node. **Do not compare that hidden H1 with the desktop title as though it were visible.** Likewise, transcript `.prose-chat` index 0 is the user's bubble; index 1 is the assistant response. Settings heading measurements require a visibility-aware follow-up rather than trusting bounding rectangles alone.

## Implemented geometry and interaction results

[Verification run at bcb488b](https://github.com/Blockigaming/KovaGPT/actions/runs/44198868289): all 48 routed page measurements passed, including the unchanged desktop contract and phone/landscape proportional assertions. 83 existing mobile behavior checks passed; five viewport-inapplicable cases were skipped. The build, lint, TypeScript and 76 focused unit regressions also passed.

The rich-output comparisons passed their typography, code inset and local-overflow assertions. Seven model-menu checks sampled an in-progress entrance scale (painted widths 278.6–281.3 versus the 282 target); the test now polls the unchanged 282 target before comparing bounds. The latest check on [PR #717](https://github.com/Blockigaming/KovaGPT/pull/717) records the final run for this correction. It does not relax the dimensions or remove the containment/focus assertions.

Production is not changed by this branch. Full CI also reports a separate existing high-severity Picomatch dependency advisory, [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). As checked November 17, the advisory covers published releases through 4.0.7 and lists no patched version; npm confirms 4.0.7 is current and 4.0.8 is not published. No audit threshold, dependency version or production setting was changed to suppress that failure.

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

A completion percentage requires a fixed inventory and evidence for each state; the open families above are not counted as completed. A passed page-overflow check alone does not establish visual parity.

## Reproducible Kova measurement

The suite opens eight real routed states with synthetic service/account data at desktop 1440 × 900, touch viewports 320 × 700, 390 × 844, 430 × 932, landscape 844 × 390 and tablet 768 × 1024. It checks desktop geometry against the saved pre-change measurements and checks the intended mobile relationships. Both themes also exercise rich text, code/table scrolling and model-menu geometry. Existing mobile suites cover navigation, focus restoration, draft preservation, reduced visual viewport and fullscreen overlays. Tests do not sign into production or invoke AI services.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:azure
bash scripts/ci/install-playwright-browsers.sh chromium
npx playwright test --config=playwright.interface-ratio.config.ts
```

Artifacts: `test-results/interface-ratio/**/geometry.json`, `layout.png`, and exact source `commit.txt`. The baseline JSON is frozen from run 44191472210, not regenerated from the new CSS. Passing results must include the unchanged desktop contract and mobile assertions; overflow-only success is insufficient.
