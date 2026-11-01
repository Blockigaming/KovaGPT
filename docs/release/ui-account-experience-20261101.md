# Account and interface corrections

This release implements the screenshot feedback for the existing Azure application.
It does not change subscription prices, existing model entitlements, or payment credentials.

- The closed rail is 60px, omits search, and remains closed in Settings. Settings has a close control, its own navigation and content scrolling. Sidebar history and navigation share a scrolling region.
- Connections uses compact cards, pill controls and unnumbered All/Connected tabs. The retired Discover destination is removed; its old page redirects home and its API returns 410.
- Shared shells expose Rename, Pin/Unpin, Share, Move to project and Delete. A successful move saves the project copy before archiving the original; changed chats and failed archives are kept.
- Project file retrieval keeps the verified caller's database identity, so the owner-checked vector search can return project context without an admin fallback.
- Plan display reads the verified effective entitlement independently from Checkout setup. Existing account-owned subscription records can open the configured Stripe portal without activating the future monthly Checkout policy. Conflicting customer identities remain blocked.
- Account email preferences use the shared rate limiter's supported bound. The previous read limit of 120 exceeded its maximum of 100 and caused every read to fail.
- Free includes up to 50 regular messages, 10 Thinking/reasoning messages and 3 uploads per UTC day. Lite and Medium use the regular allowance. Plus uses 5 times those caps, and Pro uses 15 times Plus. Existing token and provider guards remain active. Usage percentages come from server counters.
- Memory is available on every signed-in plan. Conversation updates require a separate opt-in and use explicit user statements from owned, synced, non-temporary history. Capacity and retrieved context increase with plan. Manual edits stop automatic replacement; forgetting a note suppresses its recreation. Summaries refresh in Settings and Memory Center and remain editable.
- Library utilities, image-edit controls and billing plan surfaces use rounded controls and contained panels. Selected response-style hints no longer overlap the control value.
- Help adds eight distinct recovery stages to its guided diagnostics, adding more than 100,000 contextual troubleshooting paths. These are guided combinations, not 100,000 independently authored articles or a universal solution guarantee.
- Product identities use KovaGPT Model 4.6 names, built by Kova. Direct questions about configured model providers still receive accurate information.

Includes the Tasks/audio access preservation reviewed in PR521, the Tasks membership/admission correction from PR523, and the Free connector correction merged through PR526. Production Tasks availability also requires the reviewed foundation SQL, policy flag and an authenticated scheduler heartbeat; changing its UI label alone is insufficient.

## Rollout dependencies

Apply the new message/memory migration before routing traffic to this image. Its functions are service-only and use the existing owner, privacy epoch and deletion-fence boundaries. Deploy the previously approved sharing and Tasks prerequisites through the scoped procedure, preserving existing application/worker settings and rollback revision.

Qualification and live acceptance are tracked separately. A passing source or browser-fixture test is not evidence that SQL or production configuration has been activated. One previously approved Azure build attempt, capped at USD5, remains the deployment budget; no attempt has been submitted by this continuation.
