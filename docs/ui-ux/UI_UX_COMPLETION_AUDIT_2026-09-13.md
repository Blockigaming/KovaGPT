# KovaGPT UI/UX completion audit

Snapshot date: 2026-09-14

## What “every page” means

This audit records every discoverable public canonical URL and reusable interface template. Under the strict linear measurement, every OpenAI or ChatGPT source page has weight 1, including localized and public user-generated pages. The machine-readable sources of truth are `live-surface-inventory.json` and the one-row-per-source-page `page-by-page-progress.json`.

KovaGPT will create original, Kova-branded equivalents for product and information architecture. It will not copy third-party wording, media, trade dress, trademarks, private account data, or user-generated content. Those source pages still remain in the denominator until an original, lawful Kova equivalent is implemented and verified.

## Live inventory

| Surface                       |                 Live result | Meaning for KovaGPT                                                                                                                         |
| ----------------------------- | --------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI sitemap index          |           38 child sitemaps | Complete discoverable sitemap-family inventory                                                                                              |
| OpenAI canonical URLs         |           1,706 unique URLs | Mostly reusable editorial, plugin, partner, policy, and publication families                                                                |
| ChatGPT sitemap               |                     98 URLs | 63 localized homes, 19 public GPT details, 10 translation tools, and 6 other canonical pages                                                |
| ChatGPT marketing navigation  |  51 canonical English paths | Product, feature, plan, use-case, app, business, education, download, and sales families                                                    |
| ChatGPT authenticated UI      | 12 static templates/dialogs | Not verified by the public audit run; requires a separately dated authenticated observation                                                 |
| KovaGPT source routes         |               174 templates | 75 UI templates, including the root shell, and 99 API/service templates                                                                     |
| KovaGPT public registry       |                   546 pages | 66 index/content pages plus 480 feature, plan, academy, policy, solution, business, ecosystem, app, form-status, and global-affairs details |
| KovaGPT reviewed public paths |                   610 paths | Includes explicit, detail, dynamic, publishing, developer, academy, policy, ecosystem, form-status, global-affairs, and localized templates |
| KovaGPT sitemap               |         167 canonical paths | Approved substantive product, academy, plan, feature, solution, trust, and utility pages                                                    |

Counts can change as source sites publish or retire pages. Re-run `npm run audit:ui-surfaces` to refresh the complete inventory.

## Strict linear page progress

| Measurement                    |                      Count |
| ------------------------------ | -------------------------: |
| OpenAI source pages            |                      1,706 |
| Unique ChatGPT source paths    |                        146 |
| Total equally weighted pages   |                      1,852 |
| Exact-path Kova counterparts   |                        534 |
| Remaining source pages         |                      1,318 |
| Progress per completed page    | 0.053996 percentage points |
| Current strict page completion |                     28.83% |

An exact path is counted only when it is present in KovaGPT's reviewed public routes or concrete UI route templates. Shared templates, proposed routes, exclusions, and family-level coverage do not increase this percentage by themselves.

## Source families and Kova disposition

| Source family                                                       | Kova status                        | Final treatment                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core chat shell and conversation detail                             | Implemented                        | Finalize responsive states, composer, navigation, loading, empty, error, and accessibility behavior                                                                                                               |
| Images and library                                                  | Implemented                        | Finalize cards, filters, previews, empty/error states, and responsive behavior                                                                                                                                    |
| Projects and project chats                                          | Implemented                        | Finalize navigation, ownership states, settings, files, and nested chat continuity                                                                                                                                |
| Scheduled tasks                                                     | Complete                           | `/scheduled` is a compatibility entry for canonical `/scheduled-tasks`                                                                                                                                            |
| Plugin/app directory                                                | Complete                           | `/apps`, four working connector details, and three explicit unavailable-compatibility pages use shared Kova components                                                                                            |
| Product overview and feature landing pages                          | Complete                           | Existing landings are upgraded and supported feature details are linked from the product hierarchy                                                                                                                |
| Deep research                                                       | Complete                           | `/features/deep-research` routes into the working research tools                                                                                                                                                  |
| Study mode                                                          | Complete                           | `/features/study-mode` routes into the working study tools                                                                                                                                                        |
| File/PDF analysis                                                   | Complete                           | `/features/chat-with-pdfs` explains the supported file workflow and routes to `/files`                                                                                                                            |
| Shopping                                                            | Public explanation implemented     | Retain truthful research-only boundaries; do not imply live merchant fulfillment                                                                                                                                  |
| Use-case details                                                    | Complete                           | Eleven original supported-workflow pages use one reusable content contract                                                                                                                                        |
| Solution blueprints, industries, and use cases                      | Expanded                           | Eleven exact-path solution pages cover bounded Kova retrieval, MCP, industry, agent, coding, content, data, and research workflows                                                                                |
| Academy learning guides                                             | Complete for current inventory     | Thirty-eight exact-path Kova Academy pages provide original foundations, role workflows, coding, research, file, and safety guidance                                                                              |
| Policy detail references                                            | Complete for current inventory     | Sixty-two exact paths route to original Kova status guidance and current controlling documents without importing third-party terms                                                                                |
| Business guides, updates, and solution references                   | Complete for current inventory     | Forty-nine exact paths provide original Kova workflows or explicit availability boundaries without inventing offers or endorsements                                                                               |
| Individual plan details                                             | Complete                           | Free, Plus, and Pro details derive their prices and limits from the authoritative capability registry                                                                                                             |
| Business role/solution details                                      | Complete                           | Seven role/solution pages avoid invented enterprise claims and lead into real Kova tools                                                                                                                          |
| Education and parent resources                                      | Complete                           | Student, teacher, university, college, and parent guidance is represented with safety boundaries                                                                                                                  |
| App integration details                                             | Complete                           | Google Drive, Gmail, Google Calendar, and GitHub details reflect the supported connector catalog                                                                                                                  |
| Health                                                              | Complete                           | `/health` and its related use case provide safety-first information without presenting KovaGPT as medical care                                                                                                    |
| Download/import                                                     | Informational equivalents complete | Explain web-only access and supported text/file inputs without presenting a fake installer or account import                                                                                                      |
| Merchant onboarding                                                 | Status equivalent complete         | Explain that merchant onboarding is unavailable without collecting feeds, credentials, inventory, or payments                                                                                                     |
| Voice and voice-with-video                                          | Availability pages complete        | Publish the boundary and readiness requirements without rendering recording controls                                                                                                                              |
| OpenAI editorial articles and releases                              | Not Kova content                   | Use Kova’s existing publication template for original approved content; do not clone the archive                                                                                                                  |
| OpenAI plugin/partner directories                                   | Exact-path Kova status references  | 177 original Kova pages distinguish four supported app guides from unavailable connections and unverified provider relationships                                                                                  |
| OpenAI company, policy, learning, privacy, safety, and science hubs | Kova equivalents expanded          | Use original Kova structure, guidance, and honest unavailable program states without copying source-company claims                                                                                                |
| OpenAI form routes                                                  | Exact-path Kova status references  | Forty-three original status pages collect no submissions, claim no external program availability, and route to Kova support, sales, or policies                                                                   |
| OpenAI global-affairs routes                                        | Exact-path Kova references         | Fifty original Kova guidance and status pages provide education, policy, readiness, safety, or availability context without importing external relationships, programs, testimony, endorsements, or announcements |
| Source-specific personalities, products, and store                  | Unrelated or owner-controlled      | Do not create deceptive Kova claims or clone source-company content solely to occupy a path                                                                                                                       |
| Localized duplicates                                                | Template implemented               | Maintain one locale template and add translations only when owned and reviewed                                                                                                                                    |
| Public GPT details and user-generated content                       | Dynamic instances                  | Use Kova’s assistant-detail template; never bulk-copy third-party listings                                                                                                                                        |

## Five-step completion gates

1. Inventory is complete when the generator succeeds, the full JSON is committed, counts are tested, and relevant page families have a disposition.
2. Existing pages are complete when route, content, responsive, dark-mode, keyboard, focus, loading, empty, error, and truthful-control audits pass.
3. Missing relevant families are complete when reusable Kova templates and owned content exist with canonical routing and no unsupported claims.
4. New pages are complete when visual hierarchy, copy, calls to action, metadata, navigation, and responsive behavior meet the same system as existing pages.
5. Release verification is complete when format, lint, typecheck, unit, browser, accessibility, visual, build, route crawl, internal-link, metadata, and release truthfulness gates pass.

## Implemented family-level set

- Added 480 original detail pages spanning features, plans, Academy, policy references, business guides, plugin/partner, form-status, and global-affairs references, use cases, solution blueprints and industries, apps, coding, translation, writing, and student guidance.
- Added 33 original top-level pages spanning product, education, access, coding, assistants, merchant status, remote work, voice, learning, company structure, privacy, safety, science, and program availability.
- Upgraded the shared public hero, calls to action, responsive navigation, page hierarchy, related-page discovery, and four-column footer.
- Expanded the approved sitemap from 23 to 167 canonical public paths and the reviewed public-route set from 87 to 610 paths.
- Added 10 exact source-locale entry paths backed by Kova's owned Arabic, Portuguese, German, Spanish, French, Japanese, and Korean translations.
- Added a live-source inventory generator and machine-readable record covering all discovered source URLs and every Kova route template.

## Verification record

- Strict source-page status: 534/1,852 discovered source pages have an exact-path Kova counterpart. The September 14 refresh added `/index/detecting-wildfires-early` and `/index/fyxer` to the outstanding set.
- Public runtime crawl: 610/610 reviewed routes return HTTP 200 with a heading, unique metadata, canonical URL, and skip link.
- Link and metadata audit: zero broken internal links, duplicate titles, duplicate descriptions, duplicate canonicals, missing titles, missing descriptions, or missing canonical links.
- Expanded public browser matrix: all 12 bounded groups pass for the 457-route Academy, policy, solution, business, ecosystem, form-status, global-affairs, and expanded-hub subset across phone, tablet, and desktop in light and dark modes (2,742 route/viewport/theme states). The separate 610-route runtime crawl verifies every reviewed path but is not represented as responsive browser coverage.
- Public detail suite: all five bounded desktop groups pass for all 469 applicable detail pages, and the representative detail-family check passes at phone, tablet, and desktop widths in both light and dark modes, including global-affairs, form-status, supported-plugin, and unverified-provider pages.
- Earlier combined product browser matrix: 38 applicable tests pass and 13 project-scoped cases are intentionally skipped; functional, responsive, keyboard, focus, hydration, visual-baseline, public-page, and secondary-screen assertions are clean.
- Full unit suite: 1,783/1,783 tests pass locally; the previously published exact-head hosted verification also passed.
- Integration suite: 503/504 tests pass. The sole failure is the generated-Worker boot probe because the local sandbox denies Wrangler host-interface enumeration with `uv_interface_addresses returned Unknown system error 1`; the production Worker artifact contract itself passes.
- Static and build gates: formatting, ESLint, TypeScript, the production Cloudflare build, the local Node preview build, strict built-artifact provenance, and the recalibrated main-bundle budget pass.
- Visual baselines: two stale phone snapshots were manually reviewed and refreshed to the current touch-safe login action; representative feature, plan, and business pages were also inspected in desktop light, mobile light, and desktop dark presentations.
- Accessibility: source contract and signed-out phone/desktop light/dark browser checks pass.
- Truthfulness: visible-control audit passes with zero fake controls; unavailable voice UI remains absent.
