# KovaGPT public marketing rework

The public marketing shell now uses a wider layout, larger fluid headings, readable article text, and a dark green KovaGPT palette. The overview has a new hero and decorative idea illustration. Catalog article pages use the same navigation and visual system as the older public routes. This change does not replace the signed-in workspace or the root sign-in page.

26 owned public canonical paths containing `chatgpt` now use `kovagpt`. Existing bookmarks redirect through an exact allowlist with HTTP 301; canonical destinations do not redirect again. Actual third-party provider URLs and truthful affiliation statements remain intact. Generated route types include the new `/kovagpt-alternative` destination and the old redirect route.

## Local evidence

- TypeScript check passed during implementation.
- 28 focused existing SEO/public-content tests passed, plus 3 URL migration tests.
- Chromium rendered the actual ProductOverview and PublicWebsiteArticle components in the isolated UI fixture at 1440px and 390px. Overview, company, and chat feature pages had no horizontal document overflow in those captures.
- Screenshots are component previews with shipped public logo assets, not evidence of a production deployment or of every route passing.

To run the isolated component preview with public logo and font assets:

```sh
npx vite --config tests/ui-foundations/marketing-preview.config.ts --host 127.0.0.1 --port 4191
```

Select `?surface=public-overview`, `?surface=public-company`, or `?surface=public-features-chat`.

Full CI and actual application route/browser acceptance remain required before merge. Legacy source-review records describe historical reference URLs and are not rewritten as new runtime evidence.
