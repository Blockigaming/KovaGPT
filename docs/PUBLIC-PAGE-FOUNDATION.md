# Public-page foundation and publication contract

## Scope and ownership

This work prepares the reusable public UI, a publication checker, and a source-backed capability truth list. It does not populate new pages from an external inventory, certify deployed services, replace legal review, or grant permission to merge or deploy. It extends the existing public system rather than creating a second site framework.

The foundation is based on the shared-UI PR #347. The provider-backed Maps implementation and intentional Deep Research retirement belong to PR #335. Preserve both when integrating. A legacy declaration on one branch is not an approved public feature. Do not restore Deep Research or add a Codex product to satisfy a coverage count.

## Reusable components

| Component                      | Responsibility                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `PublicShell` / `PublicHeader` | Public navigation, responsive disclosure, Escape/focus restoration, header-aware scroll spacing, safe-area layout and shared footer |
| `PublicFooter`                 | Existing public, legal, security and support destinations; wrapping 44px actions                                                    |
| `PublicPageView`               | Landing hero, original summary, primary/secondary actions, content grid and review-status banner                                    |
| `PublicDetailPageView`         | Breadcrumbs, detail hero, highlights, section cards, optional FAQ, related directory cards and closing action                       |
| `SeoLanding`                   | Readable introduction, benefits, examples, optional details and the shared FAQ                                                      |
| `LegalArticle`                 | Long-form document typography; does not supply or approve legal copy                                                                |
| `PublicFaq`                    | Native accessible details/summary disclosures; no invented answers and no JavaScript-dependent expansion                            |
| `PublicState`                  | Loading, empty, unavailable and error content inside the caller's existing main landmark; no feature activation                     |
| `public-foundation.css`        | Public-only reading widths, anchor/focus scroll spacing, reduced motion and forced-color focus styling                              |

Keep original page data in the existing `src/lib/public-*-content.ts` registries. The renderer owns spacing and interaction; the record owns truthful, specific copy. Use optional sections only when they add useful information, not to pad an arbitrary word count. Pricing, account state and provider access remain server-owned.

`PublicDetailPage.faq` is optional, with `{ q, a }` records. Use one main landmark and one H1 per rendered route. The state component deliberately does not add a second main or H1. The header observer adjusts focus/anchor offsets when navigation wraps or text size changes and disconnects on unmount.

## Commands

Run `npm ci --ignore-scripts --no-audit --no-fund` in the supported Node 24 environment first.

```sh
# Test the checker itself, including deliberately invalid content and evidence.
npm run public:test

# Inspect the CURRENT Kova route inventory and original content without claiming approval.
npm run public:audit

# Fail unless every inventoried route has valid content AND current bound evidence.
npm run public:ready -- --evidence /path/to/reviewed-evidence.json

# Collect desktop render observations against an already-running LOCAL preview only.
npm run public:render -- --base-url http://127.0.0.1:8080 --paths /features/voice
```

The audit writes `artifacts/publication/readiness.json`, `readiness.md`, and `capabilities.json`. Audit-only mode may exit zero while `strictGatePassed` is false: it means the inspection completed, NOT that publication is approved. Strict mode exits nonzero for missing evidence, uncovered adapters, invalid routes/content/actions, pending legal/admin review or failed observations. CI tests the checker and archives its findings; existing incomplete pages are not relabelled green.

## What the inventory means

The loader reads the actual public registries, SEO review paths, and generated router patterns. It does not invent page copy or import an unfinished OpenAI/ChatGPT inventory. A route whose content adapter is absent is explicitly uncovered. Matching a router pattern alone does not prove its loader succeeds: fresh rendered HTTP/content evidence is also required. Static sitemap omissions are checked when a record explicitly requires indexing; intentionally non-indexable public routes are not silently added to the sitemap.

The loader evaluates only trusted checked-in source in restricted development contexts. It rejects external imports and non-content paths. Node's `vm` is not a security sandbox; do not feed it untrusted uploaded code.

## Publication evidence

Each route needs four records: `render`, `responsive`, `accessibility`, and `editorial`. All must have `status: "pass"`, the exact page `fingerprint` from the current audit, a UTC `checkedAt`, and an inspectable `reference`. Evidence expires after 14 days, cannot be future-dated, and is invalidated when content, capability policy, renderers, styles, routing or the dependency lock changes. Do not edit fingerprints to carry old approvals onto new code.

- Render facts require HTTP 200, one main/H1, matching content and metadata, one correct canonical, navigation/footer, checked links/images, no runtime errors, bounded layout and checked JSON-LD. The collector checks local destination registration, same-page anchors, image load status and JSON syntax; it does not certify all external sites or full schema.org semantics.
- Responsive evidence requires all seven widths (320, 390, 768, 1024, 1280, 1440, 1728), both themes, and 100%/200% root text. A partial sample cannot stand in for the matrix.
- Accessibility evidence requires named keyboard, focus, semantics, contrast and reduced-motion results. These checks do not by themselves constitute a WCAG conformance certification.
- Editorial evidence needs an accountable reviewer and affirmative capability-claim review. Read the page, verify its actual claims and external destinations, inspect appropriate screenshots and structured data, and obtain any separately required legal/admin approval. Do not automatically fill this record from a passing build.

Evidence JSON is an attestation, not cryptographic proof of a review. Keep its referenced artifacts and review ownership in the PR. Cancelled/skipped runs, missing screenshots and a passing unrelated commit do not qualify. The local render collector produces only render observations, never responsive, editorial, accessibility or production approval.

## Capability truth

`capabilities.json` is rebuilt from the actual capability registry and broader platform declarations. It separates `sourceAvailability` from `publicStatus`, names dependencies and limitations, records evidence paths and SHA-256 hashes, and marks production verification false unless a separate verified process establishes it. This source audit does not establish that process.

- `source-implemented`: code is declared available, not proven live.
- `configuration-dependent`: provider credentials, scopes, permissions, deployment and account policy must be verified.
- `limited`: describe the recorded limitation; do not extrapolate full functionality.
- `release-gated`: explicit approval is missing; do not advertise immediate use or change the gate.
- `unavailable`: no supported public availability established.
- `excluded`: outside approved public product scope, including Codex and retired Deep Research.

The broader platform catalog is preserved as `catalog-declaration-only`. A route, a plan price, a screenshot, an app catalog entry and a successful source build are not proof of a working service. The source list deliberately differs from earlier conversational examples that called Chat, Search, Images or integrations simply “available.” No credentials are read and no provider or live account is called.

## Verification and integration

The foundation workflow checks repository formatting, lint, typecheck, full unit tests, production build, checker rejection behavior and the real shared-component fixture in Chromium, Firefox and WebKit. It uploads exact source provenance, full logs, screenshots and JSON results. Generated fixture output is never deployed.

The fixture matrix checks shared templates and controls, not all live pages, all assistive technologies, physical touch devices, or legal/marketing accuracy. Keep the existing public route/core browser and database gates from #335/#347. Do not claim the entire website finished because the foundation passes. New pages from the external inventory must still supply original content and pass the publication contract.
