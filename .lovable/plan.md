## Scope

This turn tackles a large polish + fixes pass. To ship real quality (not a shallow surface pass) I'll split it into two waves. Wave 1 is what I'll build this turn. Wave 2 lists the items I want to confirm before spending credits on them, because they conflict with existing decisions or need scanner output first.

## Wave 1 — Ship this turn

### Sidebar & background
- Add a 1px vertical divider on the sidebar's right edge so it separates cleanly from the main surface (both now share the same `--background`).
- Add a subtle, animated mesh-gradient background layer behind the app shell (fixed, `pointer-events-none`, low-opacity `--kova-blue` and violet radial blobs with a slow 20s float). Works in light + dark.

### Global type scale
- Reduce the app's base font-size from `16px` to `15.2px` (~5% smaller) on `html`. All Tailwind rem-based sizes scale with it, so headings/inputs/buttons shrink proportionally without touching every component.

### Brand system ("Kova" visual language)
- Add signature tokens in `src/styles.css`:
  - `--kova-blue: oklch(0.62 0.19 255)` — primary brand accent
  - `--kova-blue-glow` — soft radial glow variant
  - `--gradient-kova: linear-gradient(135deg, kova-blue → violet)` — the signature Kova gradient (used on send button, active states, logo halo).
  - `--shadow-elevate` — premium hover elevation shadow (used everywhere elevated).
- Standardize border radius via existing `--radius` (already `0.875rem`); nudge cards/inputs to use `rounded-2xl` consistently.

### Kova logo
- Gentle floating animation (`@keyframes kova-float`: `translateY(0 → -3px → 0)` over 4s, ease-in-out infinite) applied on `NovaLogo` in the sidebar brand row + empty-state hero.

### Chat composer (ChatInput)
- Larger, more rounded pill container (`rounded-3xl`, more padding, deeper `--shadow-elevate` on focus).
- Attachment / voice / image icon buttons become floating circular chips inside the composer with hover elevation.
- Textarea already auto-expands via `rows` + `useLayoutEffect` — verify and tighten min/max height.
- Send button uses the signature `--gradient-kova` with a scale + glow "send" animation on submit.

### Messages & action bar
- Copy / Save / Share / Edit action row on assistant messages becomes sticky at the message's bottom-left with a subtle backdrop-blur pill so it stays visible while scrolling long responses.
- Animated checkmark on copy (already partially there — upgrade `Check` swap with a spring scale-in via `animate-in zoom-in`).
- AI icon (`NovaLogo` on streaming assistant row) gets a soft pulsing halo while `streaming` is true.
- Skeleton loaders (thin bars using `animate-pulse` + brand-tinted bg) replace the spinner in message idle states.

### Motion system
- Add reusable utility classes in `src/styles.css`:
  - `.animate-kova-float` (logo)
  - `.animate-kova-pulse` (assistant-thinking halo)
  - `.hover-elevate` (translateY(-1px) + shadow-elevate on hover)
  - `.animate-fade-up` (fade + 6px rise on mount — used on empty state, message groups, cards)
- Wire these into: message bubbles on mount, sidebar nav items on route change, settings dialog sections, hero on `/`.

### Shared cards / spacing / headings
- Introduce a shared `.kova-card` utility (rounded-2xl, border, `bg-card`, `hover:shadow-elevate`, `transition`) — retrofit Apps, Library, Projects, Scheduled-tasks, Pricing tier cards.
- Bump `<h1>` empty-state greeting +10% + tighter tracking; conversation titles in the sidebar go from `text-[14px]` → `text-[15px]` semibold when active.
- More whitespace: bump `space-y` between message groups by one step; more section padding in Settings.

### Icon sizing
- Standardize on `w-4 h-4` (inline) / `w-[18px] h-[18px]` (nav) / `w-5 h-5` (composer). Sweep AppShell, Sidebar, ChatMessage, ChatInput, SettingsDialog.

## Wave 2 — Confirm with user before spending on

These are the items I don't want to build blind. Answer inline and I'll do them in the next turn:

1. **"Fix all SEO bugs"** — I'll trigger the SEO scan now so we see the real findings list; the fixes then take a follow-up turn (they depend on what the scanner reports for the current homepage/title/meta setup, which was already customized).
2. **"Fix all security bugs"** — same shape: I'll run the Supabase linter + security scan, share the list, and fix them next turn rather than guess. Fixing every RLS/policy row blindly can break auth flows.
3. **"Fix all bugs"** — too broad to action safely. If there's a specific broken behavior (e.g. a route that errors, a button that no-ops, a mobile layout that clips), name it and it goes in the next turn. Otherwise I'll only fix bugs I hit while doing Wave 1.
4. **Custom illustrations** — takes image-gen credits and needs a direction (empty-state hero? 404? Apps grid?). Which surface should get one first?
5. **Distinctive icons** — Lucide is used everywhere. Full custom set is a big cost; a middle path is custom for the 6 highest-visibility icons (send, new chat, sidebar toggle, model selector, mic, image). OK to do just those?

## Technical notes

- No dashes anywhere in new copy (project rule).
- Homepage `<h1>` and titles stay exactly "KovaGPT" (project memory rule).
- Every new color/shadow/gradient goes in `src/styles.css` as a token — no hardcoded hex in components.
- Font-size shrink is applied at `html`, not per-component, so it survives future edits.
- Floating background layer sits at `-z-10` under `AppShell` so it never eats clicks.
- Assistant messages keep no bubble background (chat-ui rule); user bubble keeps the existing `--user-bubble` token.

## Files touched (Wave 1)

- `src/styles.css` — brand tokens, gradient, shadow, keyframes, utilities, base font-size.
- `src/components/AppShell.tsx` — animated background layer, shared spacing.
- `src/components/Sidebar.tsx` — right-edge divider, logo float class, nav item mount fade, tighter type.
- `src/components/NovaLogo.tsx` — accept `animated` prop (float + pulse).
- `src/components/ChatInput.tsx` — larger rounded composer, floating icon buttons, gradient send, focus shadow.
- `src/components/ChatMessage.tsx` — sticky action bar, animated copy check, streaming halo, skeleton loader.
- `src/components/SettingsDialog.tsx` — shared card class, tighter Apple spacing pass.
- Route pages (Apps, Library, Projects, Pricing) — swap ad-hoc card wrappers for `.kova-card`.
