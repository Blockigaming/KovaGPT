# AdSense response placement

Account: `pub-5973080139144902`. Responsive display unit: `4116284418` (Kova Free Response).

Site connection uses the AdSense Ads.txt snippet verification method. `public/ads.txt` authorizes Google's seller entry without loading the advertising script globally or adding code to the initial application bundle. Auto Ads must remain off.

The staged response component renders only below the newest completed answer in an authenticated, verified Free account's ordinary chat. It is excluded from temporary chats, project/shared conversations, previews, streaming, failed or stopped responses, and paid/unresolved plans. No model prompt, response storage, copy/export text, or API generation is changed. Ad errors never block the answer. No chat-derived targeting payload is sent. Contextual/non-personalized requests leave ad selection to Google.

## Activation gates

`KOVA_ADSENSE_ENABLED` defaults off and must stay off until:

1. Google has verified and approved kovagpt.com and its AI response placement.
2. A Google-certified consent management platform is configured and tested. The component requires settled TCF consent for storage and Google vendor 755; missing or rejected consent gives no ad requests. The CMP itself is not installed by this source change.
3. The application's two existing CSP layers have been qualified for AdSense and the CMP. The current CSP deliberately remains unchanged and blocks Google advertising scripts. Google's supported integration uses per-response nonces and strict-dynamic; this migration needs its own browser/security regression verification, rather than weakening the global policy to make ads load.
4. Privacy disclosures and age/sensitive-content eligibility have been reviewed for the actual activation scope.
5. Free/Plus/Pro, consent withdrawal, blocked ads, mobile sizing, and response independence have passed live browser tests.

Only then set the runtime flag to `true`. The flag alone does not bypass consent or CSP. This source change prepares monetization and verification; it does not establish approval, live ad serving, impressions, or earnings.
