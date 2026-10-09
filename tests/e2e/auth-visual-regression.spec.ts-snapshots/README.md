# Auth dialog screenshot environment

The phone-dark and desktop-light baselines were refreshed on October 9, 2026,
after inspecting both actual renders of the account UI update. They capture the
rounded controls, updated KovaGPT copy, visible legal links, and current shell.

The isolated Node fixture used the current candidate source and unchanged
package/lock files, with the already installed dependencies reused. Its build used
only the synthetic, same-origin auth fixture configuration; the production
Cloudflare output fingerprint was unchanged before and after the fixture build.
The initial dependency-install attempt failed before building and was not counted
as validation.

Both unchanged auth visual tests passed after baseline refresh, including email
focus, enabled Google sign-in, exactly one public provider-settings read, no CORS
preflight, no unexpected fixture request, and no auth writes. Screenshot tolerance
remains 0.005. The local run used Chromium 1194 (Playwright 1.56.0), a fresh browser
per case, and Liberation Sans 2.1.5 for Arial fallback.

This records test-baseline maintenance, not owner approval or live authentication
provider validation.
