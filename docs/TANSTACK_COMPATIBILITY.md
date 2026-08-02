# TanStack compatibility

KovaGPT pins and verifies the exact known-good TanStack package family with `npm run release:tanstack`. Server functions use the supported `.validator()` API, retaining schema validation and invalid-input tests without warning suppression.

Upgrade the family together and accept a new resolution only after SSR, hydration, routing, server-function, route-tree, bundle, and browser gates pass.
