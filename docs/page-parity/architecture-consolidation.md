> **Historical architecture input:** Current route authority is `docs/release-reconciliation/canonical-route-manifest.json`.

# Public-page architecture consolidation

## History audit

The current branch contains the page work as squashed commit `5a00b705`. Objects `6a545385`, `1dee3bb1`, `d3b04b47`, and `0ca4a605` are described by the task but are not ancestors in the local object graph; `8b9753cd` is not present in any reachable local ref. Comparing `5a00b705` with parent `b8fc3333` shows one implementation, not a coexisting 100-file implementation: 59 top-level route files before consolidation, with the public system represented by five template route files and one public component family.

## Implementation register

| Implementation                                                                | Introduced locally                      | Status                          | Resolution                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/public/PublicSite.tsx`                                            | `5a00b705`                              | Canonical                       | Keep as the only public header, mobile navigation, footer, hero, CTA, and review-gate shell.                                                |
| `lib/public-content.ts`                                                       | `5a00b705`                              | Canonical                       | Keep as the only general public-page content registry. Entries with legal/admin review stay noindex.                                        |
| `routes/$slug.tsx`                                                            | `5a00b705`                              | Canonical with guard            | Keep for the finite public registry and publishing indexes; reject all reserved application/security namespaces before registry lookup.     |
| `lib/publications.ts` + `routes/$section.$articleSlug.tsx`                    | `5a00b705`                              | Canonical                       | Keep structured index/detail data. Unknown sections and slugs fail closed. No second publication registry exists.                           |
| `lib/developer-docs.ts` + `routes/developers.$docSlug.tsx`                    | `5a00b705`                              | Canonical                       | Keep the finite developer topic registry. Unknown topics fail closed.                                                                       |
| `lib/public-assistants.ts`, `assistants.tsx`, `assistants.$assistantSlug.tsx` | `5a00b705`                              | Canonical                       | Keep Kova-owned empty-by-default registry and explicit directory route. Never import public GPT records.                                    |
| `lib/locales.ts` + `routes/$locale.home.tsx`                                  | `5a00b705`                              | Canonical                       | Keep eight reviewed dictionaries and explicit locale allowlist; Arabic is RTL.                                                              |
| `lib/seo-policy.mjs` + `routes/sitemap.xml.ts`                                | existing policy, expanded by `5a00b705` | Canonical                       | Keep one indexability allowlist and one sitemap response implementation. Preview, private, unknown, and review-gated pages remain excluded. |
| `components/SeoLanding.tsx` and existing explicit use-case routes             | pre-parity baseline                     | Still required                  | Keep for established acquisition routes with deeper route-specific content; do not duplicate those slugs in the generic registry.           |
| `components/PublicFooter.tsx`                                                 | pre-parity baseline                     | Route-specific legacy primitive | Retain for existing `SeoLanding` routes until they migrate; it is not a second router or content registry.                                  |
| `docs/product-parity/*`                                                       | `5a00b705`                              | Evidence only                   | Keep as historical product/visual evidence; do not treat as a source URL inventory.                                                         |

## Precedence and security decision

TanStack static routes retain precedence, but security does not depend on generated ordering alone. `public-route-policy.mjs` reserves application, API, OAuth, authentication, billing, administration, sharing, canvas, provider callback, and private-data namespaces. The one-segment public template checks this guard before any registry lookup. Two-segment templates separately require a finite publication section, locale, developer topic, or assistant record. Unknown values return the same 404 and never query private storage, so they cannot reveal whether a private identifier exists.

No duplicate explicit public route was removed because the unreachable `8b9753cd` implementation is not present in this tree. The generic and established explicit routes have disjoint slug ownership. The normal Vite/TanStack build regenerates `routeTree.gen.ts`.
