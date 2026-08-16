# Browser bundle gate evidence

## Scope

This record explains the release-accounting correction on the production Supabase retargeting branch. It is evidence for review; it does not replace required CI on the final release SHA.

## Verified problem

The original bundle script tried to identify the large client entry by requiring an `index-*` file to fall between 350,000 and 430,000 raw bytes. The current build no longer falls in that window.

A first repair correctly found the home-route chunk by source markers, but review proved that this route chunk is approximately 47.9 kB while the separate shared Vite entry is approximately 613.8 kB raw and 176.8 kB gzip. Selecting the marked route as the large budget target would therefore leave the shared entry unenforced.

PR #180 changes no application route modules. Its browser output is based on main SHA `89517654cd4a7f8aef4c36a8e9cd40b07fa73a0f`, so this is a release-accounting correction rather than approval of route growth introduced by the retargeting work.

## Corrected contract

The client build now emits Vite's standard manifest. The release script:

- identifies the marked home-route chunk independently of size;
- identifies the shared JavaScript entry from the single `isEntry` record in `.vite/manifest.json`;
- fails closed when route evidence or entry metadata is missing, ambiguous, or points to a missing asset;
- constrains raw and gzip bytes independently;
- keeps separate ceilings for the marked route, shared entry, Omega route, and lazy chart chunk.

The shared-entry ceilings are 625,000 raw bytes and 181,000 gzip bytes. The route ceilings are 60,000 raw bytes and 20,000 gzip bytes. Those limits retain narrow headroom over the observed current-main-based build.

## Verification required

Targeted unit coverage proves selection occurs before budget comparison and that an oversized manifest entry fails. The normal required CI must still complete a production build and run `npm run release:bundle` on the current branch head before merge or release.
