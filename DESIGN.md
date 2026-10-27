# Main assistant: Claude + ChatGPT

The main assistant uses only these two product references. Keep Kova's identity,
existing features and routes. This is a deliberate combination of reference
patterns, not a claim of an exact copy of either product or every account state.

## Reference evidence

Reviewed on October 27, 2026:

- [ChatGPT overview](https://chatgpt.com/overview/), including its
  [official conversation image](https://images.ctfassets.net/8su2tbn87fck/1HKIsAZ11GjpEEyopYfLIW/094b52522ff5edf1b2b7d1b0200fd1be/Chat.png?fm=webp&q=80&w=1920).
  The inspected pixels show neutral navigation, understated selected rows,
  compact gray user bubbles, unboxed replies and a thin-border composer.
- [Claude Cowork](https://claude.com/product/cowork), including its
  [official browser example](https://assets.claude.com/e0035a095d8888c9739f8acb305f517b25d469eb.jpg).
  The inspected pixels show warm paper surfaces, subdued prompt bubbles, serif
  prose and sans-serif controls. This is a Cowork example; it does not establish
  Claude's main-chat empty state or mobile layout.
- [Claude getting started](https://support.claude.com/en/articles/8114491-get-started-with-claude)
  and [model settings](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings)
  document the lower-left add control and compact model/effort menus.
- [ChatGPT appearance settings](https://help.openai.com/en/articles/11958281-updating-your-visual-experience-on-chatgpt)
  establish supported appearance variations. Exact reference colors can vary
  with settings and product rollout.

## Pattern mapping

| Surface          | Reference pattern used here                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting         | Claude-inspired serif typography, one centered question. The serif greeting is a proposed combination based on the reference typography. |
| Canvas           | Claude's warm paper in light mode; ChatGPT's restrained neutral hierarchy in dark mode.                                                  |
| Composer         | Quiet rounded surface, fine border, lower-left add control and clear send/stop action, using shared patterns from both products.         |
| Draft starters   | ChatGPT-style compact rounded prompt chips. Preserve the three existing draft actions.                                                   |
| Navigation       | ChatGPT-style unfilled compose row, compact labels, subtle selected state and mixed-case history heading.                                |
| Conversation     | ChatGPT-style compact right-aligned gray prompts and unboxed assistant text.                                                             |
| Output and menus | Existing code/copy panels and ordinary anchored menus/sheets, using the same quiet surface tokens.                                       |

Remove the previous custom eyebrow, tall starter cards, descriptions, diagonal
arrows, exaggerated heading tracking and inverted sidebar compose CTA. Do not
introduce other design systems, decorative gradients, new product modes or
unrelated features.

## Implementation choices

These are Kova integration values, not measurements of proprietary reference CSS:

- Light canvas `#faf9f5`, text `#242424`, prompt `#efeeea`.
- Dark canvas `#212121`, text `#ececec`, composer/prompt `#303030`.
- Navigation canvas `#f9f9f9` / `#171717`.
- System sans-serif UI; Georgia/Times system serif for the greeting. These are
  available substitutes, not the products' proprietary fonts.
- Reading column up to 760px, 56px headers, 28px composer corners and at least
  44px touch targets. Keep the existing composer sizing and responsive breakpoints.
- Chips wrap within the reading column; code and tables scroll inside their own
  containers. Keep readable text contrast and visible keyboard focus.

## Interaction and verification

Keep the established add/menu/sheet, selected-option focus, Escape dismissal,
focus restoration, draft preservation, send/stop and drawer keyboard behavior.
Keep authentication, entitlement rules and model routing intact.

Run the existing actual-app interaction and strict quality suites in light/dark
themes on desktop, tablet and phones. Review intended screenshot differences
before refreshing reference PNGs; retain the `0.005` screenshot-difference limit.
Fixture checks establish UI behavior, not live provider or production acceptance.
