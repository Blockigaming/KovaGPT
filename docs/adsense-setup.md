# AdSense response placement

Account: `pub-5973080139144902`. Responsive display unit: `4116284418` (Kova Free Response).

Site connection uses the AdSense Ads.txt snippet verification method. `public/ads.txt` authorizes Google's seller entry without loading the advertising script globally or adding code to the initial application bundle. Auto Ads must remain off.

The staged response component renders only below the newest completed answer in an authenticated, verified Free account's ordinary chat. It is excluded from temporary chats, project/shared conversations, previews, streaming, failed or stopped responses, and paid/unresolved plans. No model prompt, response storage, copy/export text, or API generation is changed. Ad errors never block the answer. No chat-derived targeting payload is sent. Contextual/non-personalized requests leave ad selection to Google.

## Activation gates

`KOVA_ADSENSE_ENABLED` defaults off and must stay off until:

1. Google has verified and approved kovagpt.com and its AI response placement.
2. Google's certified CMP messages are published and tested in the active publisher account, including applicable US state messages. The component queues CONSENT_API_READY before loading the AdSense tag that deploys those messages; it does not push an ad unit until TCF is settled. Where GDPR applies or the region is unresolved, storage and Google vendor 755 consent are required. Only Google's explicit gdprApplies=false signal permits contextual delivery without that European consent. Global Privacy Control prevents the library from loading. Every unit requests restricted data processing and teen age treatment; no personalized delivery is requested. Privacy and cookie settings removes the visible ad while opening the applicable Google consent controls.
3. The nonce integration has been qualified with the real Google library and published CMP on production. When activation is off the existing CSP is unchanged. When on, the outer server overwrites the internal nonce header with a fresh 128-bit value, TanStack applies it to SSR scripts, both CSP layers use strict-dynamic, and nonce-bearing HTML is private/no-store. This does not add unsafe-eval. Google connection/frame origins are bounded; Google's changing dependencies may require further qualification. Local synthetic-vendor tests do not prove actual Google compatibility.
4. Privacy disclosures and age/sensitive-content eligibility have been reviewed for the actual activation scope.
5. Free/Plus/Pro, consent withdrawal, blocked ads, mobile sizing, and response independence have passed live browser tests.

Only then set the runtime flag to `true`. The flag alone does not bypass consent or CSP. This source change prepares monetization and verification; it does not establish approval, live ad serving, impressions, or earnings.

## Validation scope

`tests/browser-runtime/response-advertisement.spec.ts` uses the actual React component with a synthetic Google script, never live ads. It verifies CMP bootstrap before an ad push, missing/rejected consent, withdrawal/re-consent, paid/unresolved/disabled/GPC exclusions, and vendor failures while preserving the answer. Server-header tests verify unpredictable request-owned nonces, spoofed-header removal, disabled baseline preservation, and no shared HTML caching. Real serving/approval, publisher identity, content suitability and fill remain separate activation gates.
