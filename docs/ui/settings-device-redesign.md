# Settings and device-specific layout review

Status: PR review only. Do not merge or publish without Zachary's approval.

## Device behavior

Desktop Settings keeps a persistent, searchable navigation column and a readable content column. Ten primary destinations replace the previous flat list of twenty-two; secondary sections remain available through related links, search, and their existing URLs. Destructive actions and service availability behavior are unchanged.

Phone Settings uses a separate full-screen grouped menu. Selecting a destination replaces the menu with a touch-oriented content screen. Back focuses the menu heading rather than the search field, avoiding an unexpected on-screen keyboard. Controls stack under labels, inputs use 16px text, and touch controls have larger targets. Keyboard-only preferences and the desktop navigation-width control are hidden on phones. The navigation and content panes retain independent scrolling.

Removed the conflicting Settings rules in `app-finish.css`. The Settings route and shared Settings controls now own their geometry, rather than accumulating extra card margins and forced title sizes.

Phone directories use horizontally scrollable collection chips, larger search/select fields, and a separate Library display-control row. Library items gain their own rounded cards on phones; desktop keeps compact rows. The homepage image uses a landscape phone crop and a portrait desktop crop.

## Homepage image

Mode: AI edit/restoration of the repository's existing `public/images/classroom-hero.webp`, using the built-in image generation editor. This reconstructs detail; it does not recover original photographic information exactly.

Prompt direction: upscale and restore the supplied classroom photograph while preserving its composition, people, clothing, central student in a burnt-orange sweater raising a hand, windows, daylight, and overall scene; remove blur and compression, avoid invented text, logos, or watermarks, and keep the result photographic.

Generated result: 1485 × 1059. This is not a 4K source. Original retained for comparison.

Responsive encoded assets:

- `public/images/classroom-hero-restored.webp`: 1485 × 1059, WebP quality 92.
- `public/images/classroom-hero-restored-768.webp`: 768 × 548, WebP quality 90.

Sharp only encodes the generated result and creates the smaller responsive derivative. `srcset`/`sizes` selects the appropriate asset.

## Verification scope

Browser fixtures contain synthetic account data and do not purchase subscriptions, send invitations, or call model providers. Review covers Settings navigation, all twenty-one content destinations, control containment, phone hit targets, return focus, responsive Library sorting, homepage image decoding/crops, and screenshots of core screens. This is not proof that every service or every public route works in production. No production deployment is part of this PR.
