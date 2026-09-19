# News category family — partial source specification

Reviewed 2026-09-19. Nine distinct category URLs remain nine tracked pages, sharing one listing template. Source-text inspection resolves their layout family, not visual acceptance or permission to publish copied source content.

## Observed source structure

Category title, shared category navigation, dated/tagged article links, sort and media visibility controls, and corporate navigation/footer. Additional labels vary as below. “Not observed” does not prove absence. Menus, sorting behavior, filtering and pagination have not been exercised.

| ID / primary source                                                                 | Filter label | Load-more label |
| ----------------------------------------------------------------------------------- | ------------ | --------------- |
| [KOVA-0537 · ai-adoption](https://openai.com/news/ai-adoption/)                     | Not observed | Not observed    |
| [KOVA-0538 · applied-ai](https://openai.com/news/applied-ai/)                       | Not observed | Not observed    |
| [KOVA-0539 · company-announcements](https://openai.com/news/company-announcements/) | Observed     | Not observed    |
| [KOVA-0540 · engineering](https://openai.com/news/engineering/)                     | Observed     | Observed        |
| [KOVA-0541 · global-affairs](https://openai.com/news/global-affairs/)               | Observed     | Observed        |
| [KOVA-0542 · intelligence-age](https://openai.com/news/intelligence-age/)           | Not observed | Not observed    |
| [KOVA-0543 · research](https://openai.com/news/research/)                           | Observed     | Observed        |
| [KOVA-0544 · safety-alignment](https://openai.com/news/safety-alignment/)           | Observed     | Observed        |
| [KOVA-0545 · security](https://openai.com/news/security/)                           | Observed     | Observed        |

The company-announcements URL returned a “Recent news” heading. That alone is insufficient evidence to merge it into an all-news page. Global affairs includes a public-policy introduction link; engineering and intelligence-age include introductory copy. Capture the actual compositions before deciding spacing or block counts.

## Proposed Kova implementation

Use one category page component with distinct route, category key, heading, introduction, permitted filter configuration and canonical URL. Feed it a real original-content registry. Every article needs a stable URL, title, publication date, category, summary and optional approved image with alt text. Never populate the Kova feed with renamed OpenAI announcements, Codex coverage, copied endorsements or invented Kova events.

Persist category/filter/sort in validated URL parameters; define allowed sort values after live control inspection. Keep media visibility accessible and ensure cards remain readable without imagery. Use stable article IDs, deterministic ordering and a real pagination cursor or page boundary. Preserve filters during pagination, prevent duplicate results and support keyboard focus after loading. Provide empty-category, no-results, loading and retry states. These are proposed product requirements, not observed source behavior.

## Remaining evidence and acceptance

Capture each category on desktop/mobile, open sort/filter controls, verify media toggle and pagination behavior, and inventory every block with evidence IDs. Define Kova category content and publication ownership. Verify direct routing, deep links, back navigation, keyboard access, empty states and mobile layout. No page in this family has been implemented or visually accepted by this pass.
