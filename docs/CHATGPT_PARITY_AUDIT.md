# ChatGPT parity audit

## Audit record

- **Audit date:** 2026-08-03
- **Reference targets:** `https://chatgpt.com/` and `https://kovagpt.com/`
- **Reference environment:** Playwright 1.56.0 managed Chromium 141 on Linux, identical browser context per target.
- **Harness:** `npm run audit:ui-parity`; `--quick` selects one development capture, while the default runs the complete viewport/DPR/light/dark anonymous matrix.
- **Authentication:** anonymous capture is unconditional. When both `CHATGPT_STORAGE_STATE` and `KOVAGPT_STORAGE_STATE` are set, a second authenticated matrix is mandatory and uses separate contexts.
- **Private data:** screenshots, diffs, motion traces, and storage-state files are ignored. Only the non-private manifest and semantic comparison schema are versioned.

The harness waits for DOM readiness, attempts network idle, waits for `document.fonts.ready`, and then waits for three animation frames. It records the URL, viewport, DPR, theme, pointer, authentication state, application state, timestamp, zoom, reduced-motion state, and Git SHA. An unsuccessful HTTP response aborts the run rather than substituting a stale baseline.

## Tested states and matrix

The committed matrix includes 320×700, 360×800, 375×812, 390×844, 412×915, 600×960, 640×960, 768×1024, 820×1180, 1024×768, 1280×800, 1366×768, 1440×900, 1512×982, 1728×1117, and 1920×1080 at DPR 1 and 2 in light and dark modes. The reusable context and motion helpers additionally expose coarse/fine pointer, reduced motion, storage state, semantic computed styles, layout stabilization, horizontal-overflow checks, and frame sampling. Browser zoom metadata is explicit; zoom-specific capture can be supplied by the execution environment without changing semantic selectors.

Current deterministic regression coverage checks all listed CSS viewport sizes, composer edge clearance, horizontal overflow, 16px mobile-safe input typography, focus visibility, and reduced motion. Authenticated application fixtures remain dependent on private user storage state and are never committed.

## Semantic element map

`tests/e2e/parity-helpers.ts` is the authoritative semantic mapping. The collector never compares arbitrary DOM indices. Each present element records its bounding box, computed geometry, layout, overflow, typography, color, border, elevation, transforms, transitions, and animations. SVG descendants also record their visible bounds, viewBox, and stroke width.

Each `comparison.json` entry contains the ChatGPT value, KovaGPT value, numeric box delta, branding classification, source component, source selector, required correction, and correction status. Missing elements remain explicit failures requiring a selector update; they are not masked.

## Difference and remediation ledger

| Surface                 | Original Kova value                                                                          | Live reference / gate                                               | Changed file                                                                                              | Resolution                                                                                                                                   | Remaining justified exception                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Empty greeting          | “What can I help with?”                                                                      | Public reference wording at audit request: “Where should we begin?” | `src/routes/index.tsx`                                                                                    | Updated the Kova empty-state copy.                                                                                                           | Kova remains clearly branded elsewhere.                                                             |
| Tablet composer gutter  | Wrapper could collapse to the viewport edge around 640–768px                                 | At least the measured common gutter; never edge collision           | `src/routes/index.tsx`, `src/styles/chatgpt-parity.css`                                                   | Added explicit wrapper padding and a safe-area-aware maximum width.                                                                          | None.                                                                                               |
| Keyboard focus          | Composer focus used a subtle border/shadow and suppressed textarea outline                   | Visible high-contrast focus is a hard accessibility floor           | `src/styles/chatgpt-parity.css`                                                                           | Added a two-pixel, offset `:focus-within` outline while retaining component focus behavior.                                                  | Accessibility intentionally wins if the reference indicator is weaker.                              |
| Action color preference | Exposed a nonfunctional color picker, local-storage key, event, and duplicate setting fields | No equivalent preference in the requested baseline                  | `src/components/SettingsDialog.tsx`, `src/lib/settings-types.ts`, `src/lib/principal-browser-storage.mjs` | Removed UI, defaults, persistence allow-list, and event plumbing. Old imported object fields remain harmlessly ignored by structural typing. | None.                                                                                               |
| Audit evidence          | No dedicated reproducible live comparison command                                            | Required semantic, matrix, and artifact pipeline                    | `scripts/ui-parity-audit.mjs`, `tests/e2e/parity-helpers.ts`                                              | Added fail-closed live capture, computed-style collection, metadata, private artifact handling, and motion sampler.                          | ChatGPT anti-automation may require a manually supplied baseline; the harness never invents values. |
| Regression coverage     | Existing viewport smoke suite did not enforce this audit contract                            | Every required viewport and accessibility floor                     | `tests/e2e/chatgpt-parity.spec.ts`                                                                        | Added data-driven viewport, overflow, gutter, focus, font-size, and reduced-motion assertions.                                               | Authenticated states require the two private storage-state variables.                               |

## Motion measurements

`recordMotion` samples requestAnimationFrame data for the semantic target and records elapsed time, bounds, transform matrix, opacity, background, shadow, and border. It is designed for each interaction trigger rather than a universal overlay animation. Motion JSON is written beneath the ignored `artifacts/ui-parity/motion/` directory so account-derived interaction evidence cannot be published accidentally.

The new parity layer contains only component-specific composer/sidebar/top-bar reduced-motion behavior. It does not introduce a global animation system or generic transitions for controls, cards, links, popovers, or dialogs.

## Screenshot, overlay, and heat-map evidence

The live harness writes uncropped full-page captures to `artifacts/ui-parity/screenshots/`. Raw reference images and derived overlays/heat maps are deliberately ignored because the reference can contain private content and third-party copyrighted artwork. `manifest.json` is the auditable index. CI or an auditor may retain those directories as private build artifacts. No screenshot is replaced by a fabricated image when a target blocks automation.

The pixel acceptance contract is 0.25% for mapped common regions and 0.5% full-page after dynamic-content masks, with geometry and text baseline deltas limited to one CSS pixel. Branding masks may cover changing glyph pixels, but never control bounds, spacing, padding, layout, or interaction surfaces.

## Exact modified-file inventory

- `.gitignore`
- `artifacts/ui-parity/computed-styles/comparison.json`
- `artifacts/ui-parity/manifest.json`
- `docs/CHATGPT_PARITY_AUDIT.md`
- `package.json`
- `scripts/ui-parity-audit.mjs`
- `src/components/SettingsDialog.tsx`
- `src/lib/principal-browser-storage.mjs`
- `src/lib/settings-types.ts`
- `src/routes/index.tsx`
- `src/styles.css`
- `src/styles/chatgpt-parity.css`
- `tests/e2e/chatgpt-parity.spec.ts`
- `tests/e2e/parity-helpers.ts`

## Intentional Kova Differences

KovaGPT retains its Kova logo, favicon, product name, legal identity, first-party support/subscription copy, Kova-only routes, and real supported capabilities. No OpenAI logo, private font, source code, bundled asset, audio, payload, or proprietary artwork is fetched or committed. Where a private reference typeface cannot legally be redistributed, KovaGPT uses its existing legal Inter/system fallback and tunes public CSS metrics.

## Unresolved Differences

- **Anti-automation / execution environment:** a live reference run may be unresolved when ChatGPT blocks automated Chromium or the environment lacks browser dependencies. The command fails explicitly, records no invented measurement, and accepts private manually provisioned storage state. This is the only permitted open limitation in this report.

## Validation record

Exact command results belong in the pull request and CI logs so they cannot become stale documentation. Required local commands are `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration`, `npm run test:e2e`, `npm run test:a11y`, `npm run test:visual`, `npm run audit:ui-parity`, and `npm run test:ui-parity`. A command is successful only if it exits zero; anti-automation and missing private authenticated state are reported, never silently skipped.
