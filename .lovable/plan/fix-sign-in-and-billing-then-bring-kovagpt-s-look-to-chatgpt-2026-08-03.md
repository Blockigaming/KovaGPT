# Fix sign-in and billing, then bring KovaGPT's look to ChatGPT parity

## Phase 0 — Unbreak the app (must come first)

Two files contain duplicated markup left behind by an earlier edit, and they crash the build. While the build is red, nothing renders, so sign-in "not working" and billing "not working" cannot be diagnosed separately yet.

- `src/components/auth/AuthDialog.tsx` — the header logo block is pasted twice (two different logo treatments), leaving an unclosed `div`. Keep one logo treatment (the ring/rounded-square one), delete the duplicate.
- `src/components/ChatMessage.tsx` — the user message bubble opening `div` appears three times in a row (lines 441-452). Keep one, delete the two extras.

## Phase 1 — Database objects the code already expects

The write/document feature and the payments webhook reference database objects that do not exist yet, which is what produces the long list of "not assignable to parameter of type never" type errors.

Missing:
- table `writing_documents`
- table `writing_document_versions`
- function `save_writing_document`
- column `subscriptions.last_stripe_event_created_at`

One migration creates all four, with row-level security scoped to the owner, explicit grants for signed-in users and service role, and version history writes going through the function. Then regenerate database types so `src/lib/writing.functions.ts` and `src/routes/api/public/payments/webhook.ts` typecheck.

## Phase 2 — Sign-in

With the dialog compiling again, verify each path end to end in a real browser: email + password, magic link, Google. Fix what actually fails, checking in order:
- auth dialog submit handlers and error surfacing
- redirect URL used for magic link and OAuth (must be a public same-origin URL, not a protected page)
- header/sidebar affordance reflecting the session after sign-in, and sign-out clearing cached data

## Phase 3 — Billing

Verify the checkout flow: pricing page button, embedded checkout session creation, the return URL, and the webhook that flips a subscription to active. Fix whichever step breaks, and make failures show a readable message instead of a silent dead button.

## Phase 4 — ChatGPT visual parity

I will capture chatgpt.com's current interface and compare it against KovaGPT screen by screen at desktop and phone widths, then close the gaps. Coverage:

- **Type**: font stack, exact sizes and line heights for message text, headings, sidebar items, buttons, and small labels.
- **Color**: light and dark surface layers, borders, user bubble tone, muted text, hover and pressed states.
- **Spacing and width**: message column width, gap between turns, composer padding, sidebar width, page paddings at each breakpoint.
- **Composer**: height, radius, icon set and placement, focus ring, attachment and mic/send affordance, growth behavior with long input.
- **Sidebar**: row height, radius, icon size, active/hover treatment, section headers, collapse behavior.
- **Icons**: swap for the matching stroke weight and size, remove ones ChatGPT does not show.
- **Motion**: message fade-in, streaming cursor, hover transition durations and easing, dialog and sheet entry, skeletons.
- **Message rendering**: markdown spacing, list and table styling, code block chrome (header, language label, copy button), inline code, blockquotes, links.
- **Action row**: which actions are visible vs overflow, their size, spacing, and reveal-on-hover timing.
- **Mobile**: top bar, bottom sheets, safe-area insets, keyboard-aware composer, touch target sizes.
- **Secondary pages** (pricing, projects, images, library, settings): same tokens, headers, empty states, and buttons.

Everything lands as design tokens in `src/styles.css` plus component updates, so the styling stays consistent instead of one-off classes.

## Technical notes

- Parity work is presentation-only: tokens, class names, transitions, and icon choices. No changes to chat, auth, or billing logic in Phase 4.
- Phases 0 and 1 are prerequisites; the type errors block every build until the migration and type regeneration land.
- I will run the build and a browser pass at desktop and phone widths before reporting done.

## Scope note

Pixel-identical cloning of every ChatGPT screen is not achievable in one pass, and copying their exact brand marks is not something I will do. The target is: same font system, same spacing scale, same sizing, same hover and motion behavior, same icon language, same layout structure and rendering of responses, so KovaGPT reads as the same class of product on both desktop and mobile.
