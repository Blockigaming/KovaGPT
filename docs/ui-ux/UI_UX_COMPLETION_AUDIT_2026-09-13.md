# KovaGPT UI/UX completion audit

Snapshot date: 2026-09-13

## What “every page” means

This audit records every discoverable public canonical URL and reusable interface template. Under the strict linear measurement, every OpenAI or ChatGPT source page has weight 1, including localized and public user-generated pages. The machine-readable sources of truth are `live-surface-inventory.json` and the one-row-per-source-page `page-by-page-progress.json`.

KovaGPT will create original, Kova-branded equivalents for product and information architecture. It will not copy third-party wording, media, trade dress, trademarks, private account data, or user-generated content. Those source pages still remain in the denominator until an original, lawful Kova equivalent is implemented and verified.

## Live inventory

| Surface                       |                 Live result | Meaning for KovaGPT                                                                            |
| ----------------------------- | --------------------------: | ---------------------------------------------------------------------------------------------- |
| OpenAI sitemap index          |           38 child sitemaps | Complete discoverable sitemap-family inventory                                                 |
| OpenAI canonical URLs         |           1,704 unique URLs | Mostly reusable editorial, plugin, partner, policy, and publication families                   |
| ChatGPT sitemap               |                     98 URLs | 63 localized homes, 19 public GPT details, 10 translation tools, and 6 other canonical pages   |
| ChatGPT marketing navigation  |  51 canonical English paths | Product, feature, plan, use-case, app, business, education, download, and sales families       |
| ChatGPT authenticated UI      | 12 static templates/dialogs | Not verified by the public audit run; requires a separately dated authenticated observation    |
| KovaGPT source routes         |               171 templates | 72 UI templates, including the root shell, and 99 API/service templates                        |
| KovaGPT public registry       |                    97 pages | 47 index/content pages plus 50 feature, plan, use-case, tool, business, and app detail pages   |
| KovaGPT reviewed public paths |                   160 paths | Includes explicit, detail, dynamic, publishing, developer, and localized templates             |
| KovaGPT sitemap               |         103 canonical paths | Approved substantive product, plan, feature, use-case, business, app, trust, and utility pages |

Counts can change as source sites publish or retire pages. Re-run `npm run audit:ui-surfaces` to refresh the complete inventory.

## Strict linear page progress

| Measurement                    |                      Count |
| ------------------------------ | -------------------------: |
| OpenAI source pages            |                      1,704 |
| Unique ChatGPT source paths    |                        146 |
| Total equally weighted pages   |                      1,850 |
| Exact-path Kova counterparts   |                         84 |
| Remaining source pages         |                      1,766 |
| Progress per completed page    | 0.054054 percentage points |
| Current strict page completion |                      4.54% |

An exact path is counted only when it is present in KovaGPT's reviewed public routes or concrete UI route templates. Shared templates, proposed routes, exclusions, and family-level coverage do not increase this percentage by themselves.

## Source families and Kova disposition

| Source family                                                     | Kova status                        | Final treatment                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Core chat shell and conversation detail                           | Implemented                        | Finalize responsive states, composer, navigation, loading, empty, error, and accessibility behavior                    |
| Images and library                                                | Implemented                        | Finalize cards, filters, previews, empty/error states, and responsive behavior                                         |
| Projects and project chats                                        | Implemented                        | Finalize navigation, ownership states, settings, files, and nested chat continuity                                     |
| Scheduled tasks                                                   | Complete                           | `/scheduled` is a compatibility entry for canonical `/scheduled-tasks`                                                 |
| Plugin/app directory                                              | Complete                           | `/apps`, four working connector details, and three explicit unavailable-compatibility pages use shared Kova components |
| Product overview and feature landing pages                        | Complete                           | Existing landings are upgraded and supported feature details are linked from the product hierarchy                     |
| Deep research                                                     | Complete                           | `/features/deep-research` routes into the working research tools                                                       |
| Study mode                                                        | Complete                           | `/features/study-mode` routes into the working study tools                                                             |
| File/PDF analysis                                                 | Complete                           | `/features/chat-with-pdfs` explains the supported file workflow and routes to `/files`                                 |
| Shopping                                                          | Public explanation implemented     | Retain truthful research-only boundaries; do not imply live merchant fulfillment                                       |
| Use-case details                                                  | Complete                           | Eleven original supported-workflow pages use one reusable content contract                                             |
| Individual plan details                                           | Complete                           | Free, Plus, and Pro details derive their prices and limits from the authoritative capability registry                  |
| Business role/solution details                                    | Complete                           | Seven role/solution pages avoid invented enterprise claims and lead into real Kova tools                               |
| Education and parent resources                                    | Complete                           | Student, teacher, university, college, and parent guidance is represented with safety boundaries                       |
| App integration details                                           | Complete                           | Google Drive, Gmail, Google Calendar, and GitHub details reflect the supported connector catalog                       |
| Health                                                            | Complete                           | `/health` and its related use case provide safety-first information without presenting KovaGPT as medical care         |
| Download/import                                                   | Informational equivalents complete | Explain web-only access and supported text/file inputs without presenting a fake installer or account import           |
| Merchant onboarding                                               | Status equivalent complete         | Explain that merchant onboarding is unavailable without collecting feeds, credentials, inventory, or payments          |
| Voice and voice-with-video                                        | Availability pages complete        | Publish the boundary and readiness requirements without rendering recording controls                                   |
| OpenAI editorial articles and releases                            | Not Kova content                   | Use Kova’s existing publication template for original approved content; do not clone the archive                       |
| OpenAI plugin/partner directories                                 | Third-party catalog content        | Represent only Kova-supported connectors and assistants using Kova data                                                |
| OpenAI policies, forms, careers, research, Sora, Codex, and store | Unrelated or owner-controlled      | Keep Kova’s own approved policies and content; exclude unrelated company/product pages                                 |
| Localized duplicates                                              | Template implemented               | Maintain one locale template and add translations only when owned and reviewed                                         |
| Public GPT details and user-generated content                     | Dynamic instances                  | Use Kova’s assistant-detail template; never bulk-copy third-party listings                                             |

## Five-step completion gates

1. Inventory is complete when the generator succeeds, the full JSON is committed, counts are tested, and relevant page families have a disposition.
2. Existing pages are complete when route, content, responsive, dark-mode, keyboard, focus, loading, empty, error, and truthful-control audits pass.
3. Missing relevant families are complete when reusable Kova templates and owned content exist with canonical routing and no unsupported claims.
4. New pages are complete when visual hierarchy, copy, calls to action, metadata, navigation, and responsive behavior meet the same system as existing pages.
5. Release verification is complete when format, lint, typecheck, unit, browser, accessibility, visual, build, route crawl, internal-link, metadata, and release truthfulness gates pass.

## Implemented family-level set

- Added 50 original detail pages spanning features, plans, use cases, business, apps, coding, translation, writing, and student guidance.
- Added 13 original top-level pages spanning product, education, access, coding, assistants, merchant status, remote work, and voice availability.
- Upgraded the shared public hero, calls to action, responsive navigation, page hierarchy, related-page discovery, and four-column footer.
- Expanded the approved sitemap from 23 to 103 canonical public paths and the reviewed public-route set from 87 to 160 paths.
- Added 10 exact source-locale entry paths backed by Kova's owned Arabic, Portuguese, German, Spanish, French, Japanese, and Korean translations.
- Added a live-source inventory generator and machine-readable record covering all discovered source URLs and every Kova route template.

## Verification record

- Strict source-page status: 84/1,850 discovered source pages have an exact-path Kova counterpart. The earlier family-based five-workstream implementation is not equivalent to page-by-page completion.
- Public runtime crawl: 160/160 routes return HTTP 200; 103 are intentionally indexable and 57 are intentionally `noindex`.
- Link and metadata audit: zero broken internal links, duplicate titles, duplicate canonicals, missing titles, missing descriptions, or missing canonical links.
- Exhaustive public browser matrix: 36/36 groups pass across phone, tablet, and desktop, covering all 160 reviewed routes in light and dark modes (960 route/viewport/theme states).
- Public detail suite: five bounded desktop groups verify all 50 detail pages, and three responsive family checks pass; 10 project-inapplicable content cases are intentionally skipped.
- Earlier combined product browser matrix: 38 applicable tests pass and 13 project-scoped cases are intentionally skipped; functional, responsive, keyboard, focus, hydration, visual-baseline, public-page, and secondary-screen assertions are clean.
- Full unit suite: 1,768/1,768 tests pass locally; the previous hosted exact-head verification run also passed.
- Static and build gates: formatting, ESLint, TypeScript, the production Cloudflare build, the local Node preview build, and strict built-artifact provenance checks pass.
- Visual baselines: two stale phone snapshots were manually reviewed and refreshed to the current touch-safe login action; representative feature, plan, and business pages were also inspected in desktop light, mobile light, and desktop dark presentations.
- Accessibility: source contract and signed-out phone/desktop light/dark browser checks pass.
- Truthfulness: visible-control audit passes with zero fake controls; unavailable voice UI remains absent.
