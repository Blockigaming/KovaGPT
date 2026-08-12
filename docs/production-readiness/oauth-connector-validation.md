# Google and GitHub connector staging validation

First validate exact HTTPS callbacks with `domain-callbacks.mjs`, then validate sanitized prerequisites with `external-harness.mjs oauth`. Use provider-owned test applications and synthetic accounts only.

For Google and GitHub separately verify exact redirect URI, unpredictable one-time state, CSRF binding, PKCE where applicable, least-privilege documented scopes, owner-bound encrypted token storage, refresh/expiry, denied consent, malformed callback, state replay, account switch, disconnect, provider-side revocation, cross-user token denial, and one real bounded tool operation. A connector remains **partially operational** until both OAuth and tool execution pass live staging.

Never log codes/tokens/verifiers. On failure revoke at the provider, disconnect the Kova record, disable the connector surface if misleading, preserve redacted correlation evidence, and correct callback/scope/ownership behavior before retest.
