# KovaGPT platform architecture

This layer makes cross-product infrastructure explicit without replacing the existing TanStack Start, Supabase, provider, authentication, billing, or routing systems.

## Capability registry

`src/platform/capabilities.ts` is the typed catalog of major product capabilities. Each record declares its route, permission boundary, minimum plan, providers, feature flags, dependencies, and discovery keywords. Registry validation detects duplicate IDs and missing dependencies. UI discovery may read this metadata, but server authorization remains authoritative.

## Feature flags

`src/platform/feature-flags.ts` supports account overrides, plan eligibility, deterministic percentage rollout, beta and experimental metadata, and immediate kill switches. Flags default closed when unknown. Percentage assignment is stable per flag and user rather than random per request.

## Event architecture

`src/platform/events.ts` provides typed domains, immutable event envelopes, isolated subscribers, and a bounded in-memory diagnostic history. Events are process-local signals, not durable audit records. Future transports can subscribe and forward approved events to a queue without changing publishers.

## Extensions

`src/platform/extensions.ts` accepts typed contributions for navigation, commands, context providers, workspace cards, toolbar actions, composer tools, settings panels, and dashboard widgets. Duplicate extension IDs fail fast and unregister functions support hot development and tests.

## Provider adapters

`src/platform/providers.ts` defines UI-independent adapters for AI, search, image, voice, and research providers. The existing server AI registry remains the production model router; this contract is the seam for future provider families.

## Cache and observability

`src/platform/cache.ts` implements bounded-time stale-while-revalidate behavior, request coalescing, prefix invalidation, and hydration. It is opt-in because sensitive or mutation-heavy data must not be cached indiscriminately. `src/platform/observability.ts` records bounded client timings. The root runtime publishes route-view events and render timing without including user content.

## Platform Inspector

Development builds lazy-load the Platform Inspector with **Ctrl+Shift+D**. It exposes registry validity, flags, registered extensions, recent client timings, and the bounded event timeline. The component is eliminated from production builds through `import.meta.env.DEV` and never exposes environment values or user content.

## Scaling boundaries

- The event bus and metrics buffer are intentionally process-local. Million-user deployment requires an external queue, metrics backend, sampling policy, and retention controls.
- Feature configuration is code-defined. Remote control requires an authenticated configuration service, signed snapshots, audit history, and regional cache.
- SWR caching is client-local. Shared server caching requires tenant-aware keys, encryption, invalidation events, and data-classification policy.
- Capability metadata improves discovery; middleware and RLS continue to enforce authorization.
- Extension code is trusted first-party code. Third-party plugins require sandboxing, signature verification, capability grants, review, and revocation.
