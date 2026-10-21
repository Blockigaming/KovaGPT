# Reviewed account-memory safeguard — item 326

Source commits: `febec29` (automatic safeguard), `8c83909` (explicit reviewed save).

Automatic conversation updates now submit only enabled, changed same-chat context summaries. Legacy automatic cross-chat-memory requests fail closed before any summarizer or persistent account-memory write. Same-chat summaries, saved-memory reads, deletion/privacy barriers and existing Memory Center edits remain separate.

Response More exposes an explicit review for opted-in paid, non-temporary chats. The review begins with a blank editable text field. Its confirmation explains future-chat use and replacement of any saved memory for that chat. Editing resets consent. Cancel/discard, pending/error feedback, owner/generation/navigation fencing and unchanged-history refresh preservation are covered by focused tests.

Final Save alone submits exact reviewed text. The server checks caller/tier/feature, owner, synced chat and admitted revision, non-temporary history and its actual eligible message count. It uses the existing privacy-epoch RPC, without a provider request or migration. Existing storage requires 4–30 eligible messages; short or unsynced chats show a truthful unavailable explanation. Revision validation is an admission check; privacy-epoch enforcement is atomic. A standalone account-memory Add is not implemented or claimed.

The implementing worker recorded 187 passing focused API/client/dialog/entry/coordinator/transport tests, formatting success and zero ESLint errors (one existing SettingsDialog export warning). Consolidated typecheck/build and isolated native review are separate gates. No actual account memory or provider request was used during implementation. This source record does not close native acceptance or live persistence.

Relevant tests:

- tests/api/reviewed-memory-save.test.mjs
- tests/unit/reviewed-memory-client.test.mjs
- tests/unit/reviewed-memory-dialog.test.mjs
- tests/unit/reviewed-memory-entry.test.mjs
- tests/unit/chat-summary-incremental-client.test.mjs
- tests/integration/durable-chat-summary-source.test.mjs

## Sealed local acceptance

Item 326 is verified locally using the bb18 reviewed-consent outcomes and db8 ordinary Memory Center entry. `item326-local-consent-closure.json` records exact sealed receipts, image hashes and unchanged source mappings. The earlier source-only note above describes the implementation checkpoint; this later evidence closes the explicit-consent/no-automatic-promotion requirement only. Live persistence and the stated admission-time revision limits remain unchanged.
