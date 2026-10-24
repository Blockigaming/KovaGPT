# Browser Use lifecycle preparation: NOT operational

`work-runner/browser-use-client.mjs` is an offline-tested provider lifecycle primitive, not an implementation of `kova-browser-v1`. Nothing imports it in an application route, browser manager, readiness check, runner entrypoint, or chat tool registry. No credentials, environment variables, accounts, paid calls, or deployed configuration were added. The existing networkless Work browser remains unchanged.

## What exists

- Explicit configuration defaults to disabled. Enabling requires a supplied key and an injected transport; there is no environment lookup or implicit global fetch.
- Fixed HTTPS API origin, no redirects, ten-second request timeouts, 16 KiB response bounds, and no automatic create retries.
- Standalone browser creation requests a maximum of five minutes (the provider's `timeout` unit is minutes), explicitly disables proxies, CAPTCHA solving, and recording, and does not attach persistent profiles.
- Validated provider-owned WSS endpoint stays non-enumerable in the server-only session handle. Keys and raw provider responses/errors are not returned through diagnostics. This is accidental-serialization protection, not a secrecy boundary against a caller deliberately reading the property.
- Only browser IDs created by that client instance can be stopped. `withSession` stops in `finally`, including callback errors or cancellation, and does not treat an unconfirmed stop as success. Cleanup uses its own timeout after task cancellation.
- An unknown/ambiguous create is not retried. If its response does not reveal a valid browser ID, immediate cleanup cannot be established; the provider's requested lifetime is the remaining bound. Failed stops retain client-local ownership for future reconciliation. This is not durable crash recovery.

Official API references checked October 18, 2026:

- https://docs.browser-use.com/cloud/api-v4/browsers/create-browser-session
- https://docs.browser-use.com/cloud/browser/quickstart
- https://docs.browser-use.com/cloud/browser/proxies
- https://docs.browser-use.com/cloud/browser/live-preview

## Blocking security gate

Do not wire this client into the existing browser container factory. Work's browser currently has no network interface; every subresource, redirect, script, and fetch passes through a broker that verifies current owner/run/sequence authority, permitted origins, public-address resolution, TLS, and bounded response sizes. A hosted browser has its own network path. Authorization before a CDP command does not prove authorization for its background requests. A separately named tool mode does not repair this gap.

A safe runtime integration needs reviewed and tested provider-side network enforcement or an exclusive broker path, including all background requests, redirects, WebSockets, workers, downloads, popups, and private destinations. It must retain revocation, current-account checks, origin policy, owner retirement, sequence/replay protection, task cancellation, and fail-closed ambiguous-action handling. A publicly accessible read-only page can still execute scripts and initiate side effects, so a label saying 'read only' is insufficient.

No arbitrary CDP callback should be exposed as a model tool. The callback in this primitive is a server-side composition seam for tests and a future reviewed implementation. It has no command authorization or network policy itself. A later integration must prove those controls before registering a tool or reporting browser readiness.

Further activation gates: explicit provider/data-handling review, server-side secret configuration, account spending/concurrency admission, durable cleanup/reconciliation, confirmed endpoint domains, and real integration/negative-isolation tests. No live-view URL is exposed by this client: those URLs can control the browser, and UI-only read-only options do not enforce authorization.

## Reuse existing conversation UI

When an approved adapter exists, reuse `src/lib/ai/activity.server.ts` and chat SSE events for actual command lifecycle, and the existing `web_sources`/response-source normalization for pages actually read. Extend the existing activity type union if needed. Do not create another chat backend, source store, browser manager, or revive `workers/browser-agent.mjs`.

The shipped tests exercise only synthetic injected responses. They do not verify provider availability, real authentication, network isolation, browser actions, deployed readiness, or live billing.
