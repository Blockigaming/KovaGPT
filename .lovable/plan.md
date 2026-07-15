# KovaGPT Mobile Experience Overhaul

The goal: mobile stops being "desktop shrunk with Tailwind." We fork the mobile surfaces into their own components under `src/components/mobile/*` and route to them from a `useLayout()` decision at the shell level. Desktop code paths stay byte-for-byte the same.

## Architecture

- New folder `src/components/mobile/` holds phone-first components.
- `useLayout()` (already present) picks the render path. `isMobile` (phones, <768 or UA phone) → mobile components. Tablet + desktop keep current UI.
- No CSS-only "hide/show" hacks for the mobile surfaces we redesign — different components, different trees.

```text
AppShell
 ├── isMobile  → <MobileShell>   (drawer + top bar + docked composer)
 └── !isMobile → existing Sidebar + desktop layout (unchanged)
```

## What ships

### 1. Mobile shell & navigation drawer (`src/components/mobile/MobileShell.tsx`, `MobileDrawer.tsx`)
- Replaces the `<Sidebar>` render on phones. Desktop `<Sidebar>` is untouched.
- Hamburger in the top bar opens a full-height drawer (85% width, max 340px) with:
  - Spring slide-in (framer-motion-style transform + easing), dim scrim, tap-to-close, swipe-left-to-close, ESC.
  - Auto-close when a chat is selected.
  - Large 48px row targets, larger type, generous vertical spacing.
  - Active chat pill with left accent bar.
  - Safe-area padding top and bottom.
- Top bar: hamburger (44×44), centered brand, "New chat" icon (44×44). Respects notch via `env(safe-area-inset-top)`.
- Existing `MobileFabs` is removed on mobile (its actions live in the top bar and drawer).

### 2. Mobile composer (`src/components/mobile/MobileComposer.tsx`)
- Docked to bottom with `position: sticky` inside the scroll container + `padding-bottom: env(safe-area-inset-bottom)`.
- Keyboard-aware using the VisualViewport API: subscribes to `visualViewport.resize`, sets a CSS var `--kb-inset` so composer lifts above the keyboard and the message list keeps the last message in view.
- Autogrow textarea (1–6 lines) with smooth height transition.
- Large mic (44×44), large send (48×48) with active-scale press.
- Attachment tray as a bottom sheet (photo, camera, file, plugins), not a popover.
- Reuses `onSubmit`/`onChange`/`attachments` props from existing `ChatInput` so business logic is untouched.

### 3. Mobile message list (`src/components/mobile/MobileMessageList.tsx`, `MobileMessage.tsx`)
- Full-width bubbles, 14/1.55 reading rhythm, comfortable 16px gutters.
- Compact avatar row for assistant.
- Long assistant answers auto-collapse into a **document card** with sticky Copy/Share bar (reuses `LongResponseCard` API but with mobile chrome).
- Tables wrap in a horizontally-scrollable container with edge-fade indicators.
- Code blocks: horizontal scroll, sticky 44×44 Copy button top-right, larger padding.
- Numbered/bulleted lists get mobile-tuned indent + spacing.
- Uses `react-window`-style virtualization only when message count > 40 (guarded to avoid regressions in small chats).

### 4. Mobile image viewer (`src/components/mobile/ImageViewer.tsx`)
- Full-screen portal, pinch-zoom + double-tap zoom (Pointer Events), swipe-between when a message has multiple images, swipe-down-to-dismiss.
- Opens when tapping any image inline.

### 5. Mobile menus & dialogs
- Extend the existing `Dialog` auto-bottom-sheet behavior to `DropdownMenu`, `Popover`, and `Select` on `isMobile`: they render as `MobileBottomSheet` with large 48px rows.
- Chat row "more" menu becomes an action sheet (Pin / Share / Duplicate / Archive / Delete).
- Model selector already uses `ResponsiveModelSelector` — keep.

### 6. Mobile Settings (`src/routes/settings.tsx` mobile variant)
- On `isMobile`, Settings opens as a full-screen route-like overlay instead of the desktop dialog: grouped sections, native-feeling back chevron, 56px rows, per-section pushed subpages (Account, Appearance, Data, Notifications, Help).
- Desktop keeps existing `SettingsDialog`.

### 7. Mobile voice mode (`src/components/mobile/VoiceOverlay.tsx`)
- Full-screen overlay when the user taps the composer mic and holds ≥400ms, or via the mode picker.
- Animated Kova logo, live waveform (WebAudio analyser on the mic stream), large end/mute/switch buttons at thumb reach.

### 8. Gestures & motion
- Swipe-right from left edge (<24px) → open drawer (already wired in `AppShell`; move into `MobileShell`).
- Swipe-down on image viewer / bottom sheets → dismiss.
- All transitions honor `prefers-reduced-motion` (skip transforms, keep opacity).

### 9. Accessibility
- All tappables ≥44×44. Verified via a new Playwright audit test.
- `aria-modal` + focus trap on drawer, sheets, viewer (existing `MobileBottomSheet` pattern extended).
- Respects Dynamic Text via `rem`-based scale (mobile components use `rem`, not fixed `px` for text).

### 10. Performance
- Lazy-load `MobileShell`, `ImageViewer`, `VoiceOverlay`, mobile Settings via `React.lazy` + `Suspense`.
- Virtualize message list past threshold.
- Skeleton for chat list rows in drawer while `loadConversations()` runs.

## Files (new)
- `src/components/mobile/MobileShell.tsx`
- `src/components/mobile/MobileDrawer.tsx`
- `src/components/mobile/MobileTopBar.tsx` (replaces the existing thin bar for mobile only)
- `src/components/mobile/MobileComposer.tsx`
- `src/components/mobile/MobileMessageList.tsx`
- `src/components/mobile/MobileMessage.tsx`
- `src/components/mobile/MobileLongResponseCard.tsx`
- `src/components/mobile/ImageViewer.tsx`
- `src/components/mobile/VoiceOverlay.tsx`
- `src/components/mobile/MobileSettings.tsx`
- `src/hooks/useKeyboardInset.ts` (VisualViewport)
- `src/hooks/usePinchZoom.ts`

## Files (edited)
- `src/components/AppShell.tsx` — branch on `isMobile` to render `<MobileShell>` instead of `<Sidebar>` + desktop chrome; remove `MobileFabs`/`MobileTopBar` usage in that branch. Desktop branch untouched.
- `src/routes/index.tsx` — on `isMobile`, use `MobileMessageList` + `MobileComposer` in place of the current list + `ChatInput`. Desktop path untouched.
- `src/components/ui/dropdown-menu.tsx`, `popover.tsx`, `select.tsx` — auto-render as `MobileBottomSheet` when `isMobile`. Desktop path untouched.
- `src/components/ChatMessage.tsx` — extract a shared markdown renderer; mobile message uses it with mobile chrome. Desktop rendering unchanged.
- `src/styles.css` — add mobile-only utility classes under a `@media (max-width: 767px)` block; no desktop rules changed.

## Non-goals / guardrails
- Do not touch desktop `Sidebar.tsx`, desktop `SettingsDialog.tsx`, desktop chat layout in `src/routes/index.tsx` above the mobile branch.
- Do not restyle desktop message bubbles, code blocks, or tables.
- No changes to API routes, server functions, auth, or chat streaming logic.

## Verification
- `tsgo` typecheck clean.
- Playwright `tests/e2e/responsive.spec.ts` extended:
  - iPhone 14: drawer opens on hamburger, closes on scrim tap and swipe.
  - iPhone 14: composer stays above simulated keyboard (VisualViewport mock).
  - iPhone 14: any dropdown/popover/select renders as bottom sheet.
  - iPhone 14: every visible interactive element ≥44×44.
  - Desktop 1440: no `MobileShell`, `MobileComposer`, or bottom-sheet menus in the DOM (regression guard so desktop remains untouched).
- Manual screenshots at 390×844 and 1440×900 attached in the reply.
