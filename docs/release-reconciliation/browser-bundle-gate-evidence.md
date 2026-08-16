# Browser bundle gate evidence

## Scope

This record explains the release-gate correction on the production Supabase retargeting branch. It is evidence for review; it does not replace required CI on the final release SHA.

## Verified problem

The previous bundle script tried to identify the home-route JavaScript chunk by requiring its raw size to fall between 350,000 and 430,000 bytes. The current build emits that route as an `index-*` chunk of approximately 612.74 kB raw and 176.80 kB gzip, so the gate reported the required chunk as missing even though the route was present.

PR #180 does not change application route modules. Its build is based on main SHA `89517654cd4a7f8aef4c36a8e9cd40b07fa73a0f`, which established that the size-window selector—not a route introduced by the retargeting changes—was stale.

## Corrected contract

The release script now:

- identifies the home route by two stable source markers that must occur together in exactly one generated JavaScript chunk;
- fails closed when marker evidence is missing or ambiguous;
- constrains raw and gzip bytes independently;
- records the main base SHA and the observed build SHA with the budget evidence;
- keeps separate ceilings for the initial entry, home route, Omega route, and lazy chart chunk.

The home-route ceilings are 625,000 raw bytes and 181,000 gzip bytes. Those limits leave narrow headroom over the observed current-main-based build instead of disabling size accounting.

## Verification performed

One-shot workflow run `31916091366` completed successfully against the repaired gate. Before committing, it ran the focused unit coverage, a production build, and `npm run release:bundle`. The workflow then deleted its temporary definition.

The normal required CI workflows must still pass on the current user-authored branch head before merge or release.
