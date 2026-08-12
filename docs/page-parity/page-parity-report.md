> **Superseded 2026-08-12:** This historical Workstream B report is not the current release authority. See `docs/release-reconciliation/final-release-report.md`.

# Public-page parity final evidence — 2026-08-12

## Evidence boundary

This work translates the **user-provided August 11, 2026 snapshot**; it is not a live crawl and does not claim current visual parity. The exact snapshot is retained separately from its Kova dispositions so tests can detect omissions, duplicates, or invented URLs.

## Exact source inventory

| Measure                                               |  Result |
| ----------------------------------------------------- | ------: |
| OpenAI sitemap-section records                        |   35/35 |
| ChatGPT primary-sitemap records                       |   97/97 |
| Total exact, unique, non-null source URLs             | 132/132 |
| Snapshot evidence records requiring live revalidation |     132 |
| Public GPT detail records mapped without copying      |      19 |
| Source locale-root records                            |      63 |

Disposition counts: `dynamic_template` 33, `implemented_existing` 21, `localized_variant` 9, `intentionally_excluded` 57, `requires_admin_content` 11, and `requires_legal_review` 1. There are no synthetic placeholders or null source URLs.

Page-type counts: 35 sitemap sections, 63 locale roots, 19 public GPT details, 10 translation tools, and one each of homepage, GPT directory, Images, shopping, and writing tool.

## Content and indexing review

All 87 routes that were indexable at the start of this pass have individual records in `indexable-content-review.json`. Local HTTP rendering, H1, title, description, canonical, and skip-link presence passed for all 87. Mobile and dark-mode fields retain the verified August 11 baseline rather than presenting the SSR audit as a new browser measurement.

| Decision                                 | Count |
| ---------------------------------------- | ----: |
| Keep indexable                           |    64 |
| Noindex until review or product contract |    23 |
| Redirect                                 |     0 |
| Consolidate/remove                       |     0 |
| Final sitemap entries                    |    64 |

The 23 noindex routes comprise four developer topics without a published external contract, nine empty publishing indexes, the empty assistant directory, the changelog without approved entries, and eight localized homes pending human publication review. Their routes remain available as truthful empty/planning states, but are excluded from the sitemap. This is deliberately a quality reduction in indexed breadth rather than doorway-page creation.

## Developer documentation contract

Nineteen topics were checked against registered routes and server libraries. Fifteen remain indexable with repository-bounded language. API keys, SDKs, examples, and migration guides remain available but are noindex because no versioned public lifecycle, official SDK, stable external example contract, or public migration contract exists. No price is hardcoded: approved upstream pricing, accounting reservations/settlement, and the minimum-margin policy remain server-authoritative.

## Product-surface disposition

- Apps continues to expose operational connection state separately from coming-soon entries; no unsupported connector is promoted as working.
- Assistants remains an empty reviewed directory and now stays out of search until Kova-owned assistants are approved. The 19 snapshot GPT records map only to the non-copying template family.
- Images retains prompt, styles, history, generation/error states, and ownership controls; unsupported reference-image claims remain removed.
- Deep Research remains server- and plan-gated. Maps remains a noindex privacy preview with no location request, tiles, or provider claim.
- Translation, writing, shopping, and use-case pages route their primary action into the real KovaGPT experience and make bounded capability claims.
- Eight locale templates remain structurally available (including Arabic RTL), but none is sitemap-published until human content review is recorded.

## Accessibility, security, and runtime

A root-level visible-on-focus skip link now provides a consistent keyboard entry point across application and public routes. The SSR content audit checked local HTTP 200, H1, unique metadata presence, canonical presence, and skip-link presence for every reviewed route. Four new Chromium cases visually checked the focused link at 320px, 390px, 1440px, and 1920px in light/dark and RTL states. The previously recorded 46 Chromium screenshot cases and 11-family 320px overflow matrix remain the broader responsive baseline.

Reserved public-route rejection, unknown dynamic-slug fail-closed behavior, Supabase RLS, Stripe server enforcement, Azure/provider selection, endpoint allowlists, CSRF/CSP/CORS/session boundaries, and server-only secrets were not weakened. Full-duplex Voice remains excluded while browser dictation remains supported.

## Remaining external gates

The dated snapshot still requires live revalidation. Authenticated Free/paid comparison, real Safari, physical assistive-technology review, legal publication approval, administrator content approval, official connector agreements, and a licensed Maps provider/privacy contract remain external gates. No live parity or unsupported partnership/certification claim is made.

## Final quality gates

| Check                            | Result                                                                |
| -------------------------------- | --------------------------------------------------------------------- |
| Production build                 | passed                                                                |
| Typecheck                        | passed                                                                |
| ESLint                           | passed with 0 errors and 0 warnings                                   |
| Unit suite                       | 276 passed, 0 failed                                                  |
| Browser-runtime suite            | 5 passed, 0 failed                                                    |
| Accessibility source contract    | 1 passed, 0 failed                                                    |
| Visual viewport contract         | 1 passed, 0 failed                                                    |
| Public content/runtime audit     | 87 passed, 0 failed                                                   |
| Snapshot/import tests            | 132 exact URLs, 0 duplicates or nulls                                 |
| Changed-file formatting          | passed                                                                |
| Repository-wide formatting       | 54 pre-existing files remain unformatted; no changed file is affected |
| Final representative screenshots | 4 passed, 0 failed                                                    |

The production build reports a 202.97 kB public stylesheet (32.84 kB gzip). Route-specific public chunks remain split, including the public shell at 4.02 kB and the dynamic public-page template at 1.54 kB in this build. These are build artifact sizes, not field Web Vitals; real-user performance remains an external measurement gate.
