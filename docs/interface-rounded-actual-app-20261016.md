# Rounded actual-application draft

This local source change starts at main commit `3c85a0c162782226b5ee5faa2ffb99cb1c3e7f39` and applies the supplied rounded design to the real application. It is not a deployment or a Sites update.

The original logo, auth providers, model behavior, entitlements, server functions, persistence guards, and API routes remain authoritative. The patch changes shared presentation, Library/Projects markup, and Project dialog focus restoration. It does not import the private review entry, account switcher, sample state, or generation adapters.

## Source provenance

The approved comparison source identity is SHA-256 `928cd3975018051f0ff96c6774bc33a208f54207bcb0ba55a49af87f3046106b`, not a Git commit. The supported Library text transfer supplied:

| Input                | Verified SHA-256                                                   |
| -------------------- | ------------------------------------------------------------------ |
| First global patch   | `96fa204d85c60946b58ab0215f71ad01cd3d437e5d857e13338287b025f834c8` |
| Billing CSS          | `238c2fbfc548dd29d5702d620cd9ada61e63bbf223f19ff48de2f4cfe670994d` |
| File directories CSS | `380babf253157ae3a945d2f5ae3de03eab26da7a50730e14d7b32fb4c4526a57` |
| Settings CSS         | `9f7a91af77d91ac86012988159b279a862d120c9523b21783b77ccacda037ec1` |
| Sidebar CSS          | `16e285ff0c3b7f3ea6ffb0921828796523dbd0ffe64abc4325e690386cd8e05d` |

All input hashes were verified before use. The first patch matched both the supplied base and expected output hashes. Scoped references were then adapted to current main: page variables are connected to its layout, existing Billing div/span markup is styled, project membership/colour/pin indicators are retained, and Settings switches keep a horizontal track within a 44 px hit target.

## Resulting behavior

- Shared controls and panels use the approved rounded tokens. Dialog text fields are at least 44 px high with 8 px label spacing.
- Library shows compact file cards or rows with aligned metadata. Both layouts retain selection, existing preview/other actions, and principal guards. Sharing and folder management remain available in expandable sections.
- Projects retains its routes, sorting, permissions, stored colour, counters, actions, and drag/drop behavior. Its create dialog restores focus to the actual opener after cancellation.
- Settings uses compact row groups, right-aligned switches, and the existing mobile navigation/focus contract. Billing keeps real loading, unavailable, plan, and portal states; inline support links use normal phone line boxes.
- Sidebar styling uses the actual navigation component without changing navigation eligibility or original logo assets.

Unavailable generation is not simulated: the real app's existing availability and error handling remain in place. The review-only Coming soon adapter was intentionally excluded. This is a bounded reconciliation of the supplied styles, not a wholesale replacement with the older review snapshot.

## Local preview and checks

From the isolated checkout:

```sh
KOVA_BUILD_SHA="$(git rev-parse HEAD)" npm run build:azure
node scripts/azure/local-preview.mjs
```

Open `http://127.0.0.1:4189/`, `/library`, or `/projects`. The existing runner strips credentials, disables generation, blocks server egress, and exits after 180 seconds. Restart it to extend a review. Authenticated account data requires the separately authorized development environment; the local browser test supplies synthetic data only within Playwright interception.

```sh
KOVA_TEST_CHROMIUM_PATH=/usr/bin/chromium npx --no-install playwright test --config=playwright.rounded.config.ts
```

Omit `KOVA_TEST_CHROMIUM_PATH` when using the repository's installed Playwright browser. This test runs against the actual Node build at the same local routes, checks phone/desktop light/dark layouts and controls, and saves synthetic screenshots beneath `test-results/rounded/`. Nothing from this test is imported into production.

## Terminal handoff and publication boundary

The historical `azure-core-launch-candidate` branch and `docs/auth/azure-core-launch-candidate-20261012.json` were absent. The newer parallel Interface tree `4c94f482f667109f7280b7de2e36e94dda9d9a47` was not available locally. This branch therefore remains a standalone patch against the verified main base for Terminal to reconcile onto its current candidate. Preserve newer Work/Research defaults, Library rename/archive contracts, and email/location fixes when applying it.

Auth PR #452 at `fa111d3a53599822928c9949491be2f96263aa36` was fetched for comparison only; none of its changed files is replaced by this patch. Its integrated controlled sign-in remains separate.

Terminal owns hosted development-preview delivery. The owner has reserved approval of publication for later. No push, merge, hosted workflow, Azure build/deployment, infrastructure or credential change, spending, or live sign-in is authorized by this local draft. Do not rerun the blocked production candidate build or change protected settings. The next external step must use Terminal's verified current candidate contract and explicit owner authorization for publication and any hosted execution/cost.
