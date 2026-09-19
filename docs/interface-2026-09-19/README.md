# KovaGPT interface: register and benchmark draft

This branch starts the implementation requested on September 19. It does not certify visual parity, complete Phase A, or authorize release.

## Scope and count

The working register contains **631 active destinations/templates across 634 retained records**, with 204 destinations from the 205 curated references, 4 additional documented Grok connector providers, 154 app screens/templates, 31 wider portal/content layouts, and 238 unresolved additional public-page candidates. Two former candidates are confirmed redirect duplicates, and one HubSpot-specific form is excluded from the verified provider scope. The remaining 238 are candidates. Another 70 source manifest definitions require inspection before their Kova disposition is final. **631 is not the final verified count of eligible pages.** Content instances and language variants are tracked separately from visual templates.

Each register entry has a stable ID, source references and evidence type, Kova path, baseline required features, implementation files, screenshot status, review status and completion status. Baseline requirements are planning requirements, not a claim to have inspected every source control. Source references for derived portals may be representative indexes; they are not invented captures of specific detail pages.

The complete downloadable reference backlog preserves all 67,814 retained groups / 137,430 URL variants and decisions for all 472 manifest definitions. Codex and out-of-scope named providers remain excluded from the planned targets. Existing legacy application routes have not all been removed by this foundation PR.

## Destination decisions

- Keep the business product page at `/business` and the separate company business overview at `/business/overview`.
- Keep the application catalog at `/connectors` and the business connector marketing page at `/business/connectors`.
- Combine the two general Contact Sales references at `/contact-sales`, retaining both source references. Preserve industry-specific forms.
- Use `/features/connectors` for the generic connector feature landing.

These are explicit implementation decisions, not claims of exact visual equivalence or recovered historical Combine approval. A source difference that needs its own page must be retained.

## First code changes

- Reusable `PublicHero`, `PublicSection`, and `PublicAction` components, fluid typography/spacing, and a public skip link.
- Dedicated `/overview` editorial layout with three selectable, explicitly illustrative conversations. It uses existing chat, Projects, Library, pricing and privacy destinations.
- `/pricing` comparison driven by the same published allowance copy and mode registry as the existing cards. Prices, entitlements, payment logic, and billing configuration are unchanged.
- Chat composer return-key hint follows its current desktop/mobile send behavior. This is a small foundation improvement, not a completed chat redesign.

## Evidence and validation

Thirteen initial screenshots from the owner's `Kova-v10-partial-review.zip` were recovered. Their byte hashes and dimensions match their manifests. Four images were visually inspected; the P045 desktop image is a load-error screen and is rejected as a layout reference. The remaining initial images do not establish full-page or interaction coverage. Four captures have companion failure records; those records are preserved. No historical readiness points are advanced from this recovery.

The live browser connection stalled during this turn, including a recovery attempt. No new benchmark source screenshots, candidate screenshots, mobile rendering review or authenticated end-to-end verification are claimed. Browser checks remain a requirement before these drafts are accepted. The overview is an original Kova composition draft informed by source content and recovered public-layout references, not a measured reproduction of the current ChatGPT overview.

Validation commands:

```sh
node scripts/interface/check-register.mjs
npm run typecheck
node --test tests/unit/overview-interaction.test.mjs tests/unit/capability-truth.test.mjs tests/unit/public-foundation.test.mjs tests/unit/public-shell-responsive.test.mjs tests/integration/pricing-interaction-source.test.mjs tests/integration/public-shell-source.test.mjs tests/unit/composer-keyboard.test.mjs
npm run build
```

The final command outcomes are recorded in `verification.json`. Source/component tests do not replace DOM, visual, hydration or live integration checks.

## Next work

1. Capture the chat, pricing and overview references and candidate pages at 1440×900 and 390×844, including full-page scrolling and meaningful safe states.
2. Resolve the 238 candidates, 70 app definitions and three wider filter-review groups before freezing the page total. Preserve the existing 205 curated references and exclusion history.
3. Refine the benchmark drafts against source measurements. Keep intentional Kova branding and truthful Kova product data.
4. Implement subsequent layout-family batches, recording per-page feature, link, responsive and interaction checks.
5. Verify authenticated streaming, uploads, settings, billing and provider connection lifecycles in an appropriate test environment. No live transactions or account connection changes were performed here.

Official content references inspected September 19: [ChatGPT overview](https://chatgpt.com/overview/), [ChatGPT pricing](https://chatgpt.com/pricing/), [Grok connectors](https://docs.x.ai/grok/connectors). Grok's documented catalog examples are not proof that its entire live catalog was exhaustively enumerated.

## Continuation: benchmark expansion

The live browser recovered and the current overview and pricing references were inspected at 1363×936. The overview hero measured approximately 94.7px with 94.7px line-height; its major section headings approximately 46.8px. Its full-document screenshot contains a large scroll-animation spacer, so that image does not certify all intermediate states. The chat selector was exercised. Pricing's Individual/Business & Enterprise selector was exercised. Source screenshots remain partial evidence, and mobile references are pending.

The Kova overview now includes three original illustrative use-case cards, a pricing band, and privacy/judgment cards, retaining the working example selector and FAQ. Source customer stories, unsupported product claims, Codex and out-of-scope providers were not copied into those sections.

The prior exact head `091e2fe0bc3f9c76e60d335d171232a8b2f16d23` passed Candidate Source Evidence and Shared UI Browser. Main CI and Azure readiness skipped because the PR is draft. New benchmark browser cases cover keyboard example changes, FAQ disclosure, menu focus restoration, overflow and horizontally scrolling comparison tables at four widths in light/dark across the existing three-engine workflow. New-head outcomes must be checked separately.

`node scripts/interface/build-preview.mjs [output-directory]` packages the built isolated fixture into a downloadable component review. First run the existing Vite fixture build. This is not the production app: no authentication, AI, checkout or connector services are connected. The cloud browser refused local file navigation under its URL policy; no workaround or local visual approval was attempted.
