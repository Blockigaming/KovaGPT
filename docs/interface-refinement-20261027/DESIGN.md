# Kova interface refinement

The owner's latest direction assigns ChatGPT to buttons, Grok/x.ai to spacing
and modernization, and Claude to typography. Kova's supplied logo remains the
product identity. This supersedes the earlier Claude/ChatGPT-only direction.

## Inspected references

Public pages were visually inspected in Chrome on 2026-10-28 UTC at a
1363 × 936 viewport. Measurements below come from rendered DOM geometry and
computed styles, rather than screenshot estimates.

| Reference                          | Observed pattern                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| https://grok.com/?referrer=website | Quiet, upper-third empty workspace; 752 × 102 px white composer, 24 px corner radius, 32 px greeting-to-composer gap, 40 px icon actions.                                    |
| https://x.ai/                      | Restrained monochrome surfaces, 14 px action labels, 12/16/20 px action padding, generous whitespace, minimal shadow.                                                        |
| https://claude.com/                | Serif display hierarchy and sans interface controls. Observed heading uses `anthropicSerif` with Georgia fallback; interface uses `anthropicSans` with system-sans fallback. |

The existing Kova button contract supplies ChatGPT-style pill actions, neutral
filled primary actions and round icon buttons. The public-page measurements
do not establish exact matching for every signed-in state or mobile viewport.

## Implementation contract

| Element           | Kova treatment                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons           | Existing shared pill token; 44 px minimum interaction targets; 20 px glyphs; consistent disabled, hover and keyboard-focus states.                                                                                                |
| Navigation brand  | Supplied PNG at 24 px, 16 px wordmark, 8 px mark-to-name gap; identical optical size in expanded and collapsed navigation.                                                                                                        |
| Dialog brand      | Supplied PNG at 32 px; 24 px panel and section spacing.                                                                                                                                                                           |
| Typography        | Georgia serif headings and assistant reading text; system sans controls and navigation. These use the observed reference fallback roles, rather than redistributing the proprietary typefaces. Existing code fonts remain intact. |
| Empty chat        | Upper-third composition, 720 px maximum column, compact 128 px resting composer; mobile and short-height layouts remain scrollable.                                                                                               |
| Composer actions  | Attach, Dictate, Voice and Send share a 44 px square target and 20 px optical grid; Context and Options keep concise captions when space permits.                                                                                 |
| Secondary content | Small prompt chips, one concise sign-in hint, 8/12/16/24 px spacing rhythm.                                                                                                                                                       |
| Surfaces          | Near-white canvas, white input surface, neutral dark theme, subtle one-pixel borders and restrained shadow.                                                                                                                       |
| Overlays          | Shared surfaces and sans controls; 24 px serif titles, 28 px auth title; existing collision bounds, focus return and Escape behavior.                                                                                             |

The 128 px composer and 44 px targets are deliberate Kova choices to accommodate
its additional controls and accessibility requirements. The current UI does not
claim exact pixel parity with all four reference products.

## Validation

Review desktop and phone light/dark captures, narrow-phone overflow, collapsed
navigation, auth dialog, composer popovers and a saved conversation. Existing
checks retain draft preservation, truthful disabled controls, focus visibility,
keyboard behavior and touch targets. Update visual baselines only after
inspecting actual screenshots from the changed application.
