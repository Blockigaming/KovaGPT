# KovaGPT iOS — App Store workspace

## Product scope

- Open directly to the Kova assistant, with compact sign-in/sign-up and chat when signed out. No advertising, acquisition landing pages, enterprise sales, public feature brochures or web checkout inside the iOS workspace.
- Keep the existing Kova logo, typography, colors, account identity and server-side plan entitlements. Use the established mobile chat interactions as primary reference and project/artifact organization as a secondary reference; do not copy third-party branding.
- Sidebar: New chat, Search, Projects, Library, Images, Scheduled tasks, Connections, chat history, and Settings. Preserve current mobile composer, native keyboard/attachment/share behavior, dark/light/system themes and accessible touch targets. No fake or placeholder capabilities.
- Reuse the production backend; keep provider secrets on the server. Mobile and web conversations, projects, settings and entitlements must remain account-scoped.
- Privacy, terms, support, account deletion and safe sign-in remain available. No external purchase calls to action until storefront-specific review is completed. Existing web purchases and iOS purchase restoration must be reconciled on the backend without duplicate charging.

## Implementation in this isolated draft

- Based on the unmerged native implementation from closed PR #744, at 70b58e3764132bf0acac4ff5e355d8625c9a2a14. Ported as an isolated preview onto main at c3b158aa248c3d7b43b7a1d9913867dd0a206d90. This is not a production deployment.
- The Swift navigation delegate and shared client outlet prevent the defined website-only paths from rendering inside the iOS app. Direct navigation is canceled; client-side navigation offers a return-to-chat action. Browser and Android behavior are unchanged by the new route gate.
- The route classification is an initial list, not a complete audit or an authorization mechanism. Audit all actual routes, hide website-only navigation links in native mode, and test direct, redirect and client-side navigation before release.
- The native target is ported without unrelated desktop or Android changes. The verifier-bound iOS Google handoff and its regression tests have been integrated into the main-based code; current-head tests and real-device sign-in remain required. Voice bridge consumers remain a separate integration gate.

## Release gates (not yet accepted)

1. Clean iOS target integration against current main; current SDK, device signing and a real iPhone/iPad build.
2. Actual chat sends, streaming, cancellation, reconnect, sync, projects, library, attachments, voice, notifications, and feature entitlements; graceful offline/error behavior.
3. Native sign-in handoff; equivalent privacy-preserving sign-in option where required; account deletion and token revocation; privacy manifest, permission purpose strings, third-party AI data-sharing disclosure/consent as applicable, age rating and safety controls.
4. StoreKit subscription and restore flow or a documented Apple-compliant alternative for each storefront; verify server-side entitlement reconciliation with Stripe. Do not ship unreviewed web checkout.
5. VoiceOver, Dynamic Type, safe areas, keyboard, rotation, iPad multitasking, startup, interruptions and privacy tests on devices. No claim of review readiness based on simulator alone.
6. Authorized Apple Developer Program account, App Store Connect record, TestFlight, review metadata, working reviewer credentials and approval. Enrollment must meet Apple's legal-age and authority requirements.
7. Keep production web deployment separate from app distribution; do not publish until native and backend acceptance passes.

References: <https://developer.apple.com/app-store/review/guidelines/> ; <https://developer.apple.com/help/account/membership/program-enrollment/>
