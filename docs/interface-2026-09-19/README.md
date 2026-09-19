# KovaGPT interface: register and benchmark draft

**Controlling visual direction:** match each corresponding OpenAI/ChatGPT source page with Kova branding. The independent Kova redesign described in earlier chronological notes is superseded. See [REFERENCE_STYLE_CONTRACT.md](REFERENCE_STYLE_CONTRACT.md).

This branch starts the implementation requested on September 19. It does not certify visual parity, complete Phase A, or authorize release.

## Scope and count

The working register contains **629 provisional active destinations/templates across 634 retained records**: 204 curated destinations, 4 documented Grok connector additions, 154 app screens/templates, 31 wider layouts and 236 active targets originating in the additional-public-page inventory. Of those targets, **226 still need eligibility review**; education and nine news categories now have a source-text layout specification. Three redirect aliases and two excluded records remain retained. Another **59 source manifest definitions** need disposition. **629 is not a final verified eligible-page count.** Content instances and language variants are tracked separately from visual templates.

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
2. Resolve the 226 public candidates and 59 app definitions before freezing the page total. Preserve the current 204 curated destinations, explicit merges and exclusion history.
3. Refine the benchmark drafts against source measurements. Keep intentional Kova branding and truthful Kova product data.
4. Implement subsequent layout-family batches, recording per-page feature, link, responsive and interaction checks.
5. Verify authenticated streaming, uploads, settings, billing and provider connection lifecycles in an appropriate test environment. No live transactions or account connection changes were performed here.

Official content references inspected September 19: [ChatGPT overview](https://chatgpt.com/overview/), [ChatGPT pricing](https://chatgpt.com/pricing/), [Grok connectors](https://docs.x.ai/grok/connectors). Grok's documented catalog examples are not proof that its entire live catalog was exhaustively enumerated.

## Continuation: benchmark expansion

The live browser recovered and the current overview and pricing references were inspected at 1363×936. The overview hero measured approximately 94.7px with 94.7px line-height; its major section headings approximately 46.8px. Its full-document screenshot contains a large scroll-animation spacer, so that image does not certify all intermediate states. The chat selector was exercised. Pricing's Individual/Business & Enterprise selector was exercised. Source screenshots remain partial evidence, and mobile references are pending.

The Kova overview now includes three original illustrative use-case cards, a pricing band, and privacy/judgment cards, retaining the working example selector and FAQ. Source customer stories, unsupported product claims, Codex and out-of-scope providers were not copied into those sections.

The prior exact head `091e2fe0bc3f9c76e60d335d171232a8b2f16d23` passed Candidate Source Evidence and Shared UI Browser. Main CI and Azure readiness skipped because the PR is draft. New benchmark browser cases cover keyboard example changes, FAQ disclosure, menu focus restoration, overflow and horizontally scrolling comparison tables at four widths in light/dark across the existing three-engine workflow. New-head outcomes must be checked separately.

`node scripts/interface/build-preview.mjs [output-directory]` packages the built isolated fixture into a downloadable component review. First run the existing Vite fixture build. This is not the production app: no authentication, AI, checkout or connector services are connected. The cloud browser refused local file navigation under its URL policy; no workaround or local visual approval was attempted.

Official [Codex Security announcement](https://openai.com/index/codex-security-now-in-research-preview/) confirms that Aardvark is its previous name. The Aardvark beta signup and four app definitions are therefore excluded under the existing Codex filter. Their IDs and evidence remain preserved in `scope-decisions.json`.

The authenticated source chat empty state was inspected at 1363×936. The visible composer textbox measured approximately 509×42px inside its wider toolbar. No conversation was opened or prompt submitted. Its screenshot is kept only in the private downloadable review artifact, not in this public repository. This is source UI evidence, not a Kova authentication or streaming test.

## Screenshot-led refinement

The owner supplied six desktop overview screenshots on September 19. They establish that the earlier offline export rendered locally; they do not establish mobile readiness or owner acceptance. The review found an overly heavy hero, loose vertical spacing and a neutral primary token that made the intended blue accent black.

This pass gives the public overview an explicit light/dark blue accent, a lighter and smaller hero, clearer section hierarchy, tighter section spacing and a white conversation canvas with an explicitly illustrative composer. Authenticated workspace styles and billing data are unchanged.

The downloadable review now navigates between overview and pricing comparison internally. Other internal destinations open an explanatory dialog, preserving scroll and restoring focus on dismissal. This boundary exists only in the review fixture; it does not replace production routing or claim those destinations are implemented. The exported page selector stays synchronized with internal navigation. Browser cases cover supported navigation, unavailable destinations, keyboard return, focus, responsive overflow and the distinct accent in light/dark themes.

No page has been marked visually accepted. Updated build and exact-commit browser results belong to the PR and packaged review notes.

## Phase A ledger and source-review batch

The historical nine-part score is reproducible as **65826560 / 2027091 = 32.4734114058027%** for its original 212-page cohort. It is not current overall completion. Expanded block/control denominators and historical evidence credits remain unreconciled, so the current calculator deliberately returns `percentage: null` with explicit blockers. No historical points were added by this text-review pass.

- `phase-a-ledger.json`: original weights, credits, provenance and scoring rules.
- `phase-a-history.json`: a calculation snapshot after each completed work step.
- `phase-a-progress.html`: searchable offline progress report; `phase-a-progress.json` is its calculation input.
- `source-observations.json`: 37 reviewed records, including one merged alias, with primary URLs, observations and limits. These are 36 active targets, not 37 completed pages.
- `writing-family-spec.md`: the writing hub and 21 distinct tools, observed setting/action labels, capability constraints and remaining acceptance requirements.
- `news-family-spec.md`: nine distinct category pages sharing a listing implementation contract.
- `app-route-review.json`: all 70 review records and 472 route dispositions. Seven definitions map to existing candidates; this removes duplicate definition work without approving those candidates.

The unlocalized college-students source redirects to students/2026. The locale variant remains historical provenance and was not separately tested. Voice/video pages and the student promotion retain capability/commercial holds; the Gartner source has a title/destination mismatch requiring further review. No Kova offer, provider or content claim is inferred from a source page.

The capture browser timed out on setup and one recovery attempt during this batch. No screenshot, full-control review, visual approval or production functionality is credited. Phase B remains three benchmark drafts, with no accepted pages; Phase C remains 0%.

To recalculate after a completed step:

```sh
node scripts/interface/check-register.mjs
node --test scripts/interface/phase-a-progress.test.mjs
node scripts/interface/phase-a-progress.mjs --record "Describe the completed work" --write
node scripts/interface/render-phase-a-report.mjs
```

The tests reject stale scope counts, invalid historical credits and duplicate/unknown evidence IDs. They also check writing-directory coverage and app-to-canonical-target reconciliation. Source-text observations remain partial until desktop/mobile captures, opened controls, state specifications and per-page acceptance are recorded.

## Overview composition refresh

Following owner feedback, the overview now places its interactive example workspace beside the hero on desktop and stacks it on smaller screens. Three distinct feature panels have working example-entry buttons. The page adds a compact capability strip, an illustrative Projects panel, a navy pricing section and a more contained closing section. Existing account, model, plan and provider behavior is unchanged. The standalone HTML export opens directly into the overview and keeps the existing contained navigation. Visual acceptance remains pending; no screenshot is claimed from the unavailable browser.
