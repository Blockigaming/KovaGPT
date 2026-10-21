# Actual application composer integration

This delta starts at `cfc1987d1bdf1ea1b2e7dbba01c59802baa95c04` and reconciles the supplied approved chat/composer sources into the existing `src/routes/index.tsx`. The earlier rounded application slice remains intact. This is local source integration, not a deployment.

The comparison identity is SHA-256 `928cd3975018051f0ff96c6774bc33a208f54207bcb0ba55a49af87f3046106b`, not a Git commit. All 21 files in Library manifest `libfile_4a9562527068819183b36afa853e1f4f` were reconstructed through the supported text reader and verified against their byte counts and SHA-256 hashes. Guide `libfile_7cb0ed28e1688191994bfdf1e49390af` defines the selective reconciliation.

## Resulting behavior

- Both empty Home and active chats use the rounded two-row composer, 28 px perimeter, circular 44 px Add/Send controls, and desktop Choose project / Files / Plugins strip. Pointer focus keeps one quiet border; keyboard focus uses an attached cue. Phones retain Photos, Camera, Files and Library.
- Existing send, stop, model selection, quota, upload, attachment autosave and principal-scoped services remain authoritative. No portable-review branches, fixtures, provider adapters or build flags were imported.
- Editing a previous prompt preserves the original unsent text and files; Cancel restores them and focuses the composer. Text continues using the existing per-principal draft store. Attachments remain memory-only in the mounted workspace, isolated by conversation and cleared on principal/device reset. Pending file reads cannot land after a chat/edit transition.
- Files and message settings opens the existing chat rules/pinned-files dialog and restores the invoking control. Project and plugin navigation respect pending drafts. Plugin ordering reflects saved read requests, never verified execution success.
- Chat message presentation uses the approved sizing hooks. Clipboard failure offers a real selectable-text dialog. Existing feedback, sharing, retry, saving, branch and Markdown/security behavior are retained.

## Compatibility decisions

The approved `PluginLogo` and `LAUNCH_PLUGIN_CATALOG` do not exist at this base. The composer uses a local Plug glyph and the existing connector catalog/connect-flow rules, excluding the generic Google sign-in entry. The actual Apps route has no plugin-detail search contract, so links open `/apps` without an invented selection parameter. The new sign-in prompt opens the existing Auth adapter in place; it does not change continuation routes or perform authentication itself.

Only chat-specific layout rules were selected from the approved assistant/shared stylesheet. Existing Sidebar and Auth styles, logo assets and `AppShell` route/lifecycle behavior were retained. The approved persistent-root `ChatWorkspace` architecture and chat-route-persistence helper were not transplanted.

Draft PR #453 at `24e6e3b9fbf43e2d81ac1406764b5987b7d8bb23` and separate Interface tree `e511242c7154b58e9d82dc951992b1e65531899b` are not integrated here. Neither the missing candidate nor its contract was reconstructed from guesses. Terminal must reconcile this bounded delta onto its actual current candidate while preserving those separate changes and Auth PR #452.

## Local verification and preview

```sh
npm run typecheck
node --test tests/unit/composer-draft-context.test.mjs
KOVA_BUILD_SHA="$(git rev-parse HEAD)" npm run build:azure
KOVA_TEST_CHROMIUM_PATH=/usr/bin/chromium ./node_modules/.bin/playwright test --config=playwright.composer.config.ts
node scripts/azure/local-preview.mjs
```

The existing credential-stripping, generation-disabled local runner serves `http://127.0.0.1:4189/` for 180 seconds. Browser tests intercept synthetic accounts, messages and API replies only in Playwright; no fixture code is imported into production. Screenshots are under `test-results/composer/`. The accompanying handoff records actual check outcomes and exact source identity.

No publication, push, merge, hosted job, credential change, infrastructure change, spending or live sign-in is included. A hosted development preview still requires Terminal's current candidate contract and the owner's explicit approval for the external steps.
