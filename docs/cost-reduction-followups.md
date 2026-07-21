# KovaGPT cost-reduction & polish — open follow-ups

This pass made targeted edits ONLY for the highest-impact items. The list
below tracks everything from the larger spec that was NOT implemented yet,
grouped by area so a future pass can pick them off cleanly.

## Done in this pass
- Library moved out of Settings to the left sidebar; available to signed-out users.
- Apps stays in the sidebar; signed-out users hit the existing SignInGate when opening it.
- Finances removed from the sidebar and from the Settings tab list.
- Signed-out Settings replaced with a limited KovaGPT-branded view (privacy preferences, appearance, language).
- Chat history sent to the model is now trimmed to the last 12 turns.
- Model routing simplified: cheap lite model for normal/default, mid for heavier modes, pro only for Deep/reason or image turns.

## Still open

### Settings IA / polish
- [ ] Full reorganization of Settings into grouped sections (Account, Preferences, Privacy, Subscription, Support) with collapsible groups.
- [ ] Rework remaining logged-in labels/descriptions to the KovaGPT formal voice (currently most are fine, a few read as defaults).
- [ ] Profile menu in `UserButton` already opens Settings; double-check both sidebar Settings click and profile menu open the same view.

### Auth / OAuth
- [ ] Google OAuth `redirect_uri_mismatch`: this is a Google Cloud Console config issue, not a code bug. Add the project's Supabase callback URL (visible in Cloud → Auth → Google) to the OAuth client's Authorized redirect URIs, and add the kovagpt.com origins. Keep OAuth configured directly in Google Cloud/Supabase so the KovaGPT brand remains visible.
- [ ] Password reset email: link IS sent and works as a clickable button in the default Supabase template. If it appears as plain text in some clients, scaffold custom auth email templates with `email_domain--scaffold_auth_email_templates` so we control the HTML and can guarantee a styled button + correct kovagpt.com domain. Requires verified email domain.

### Email branding
- [ ] Add KovaGPT logo header + branded layout to every `src/lib/email-templates/*.tsx` (help-contact-notification, help-contact-autoreply, future password reset).
- [ ] Mobile-friendly responsive styles.

### AI cost reduction (deeper work)
- [ ] Add explicit Normal / Advanced / Deep mode picker in the UI; gate Deep behind Plus/Pro and a higher credit cost.
- [ ] "Improve answer" action that re-runs the last turn with a stronger model on demand.
- [ ] Request classifier (rewrite / summary / coding / file question / image / deep) → route to cheapest acceptable model.
- [ ] Background summarization: when a conversation exceeds N turns, summarize and store in `chat_memories`, then drop raw turns from the prompt.
- [ ] Shorten/restructure system prompt: stable instructions first (cache-friendly), per-turn user context last.
- [ ] Response-length controls: max_tokens by mode, "Explain more" / "Make it shorter" buttons.
- [ ] No-AI-on-load guard: confirm no module-scope or route-loader AI calls. Greetings should be static strings.
- [ ] Static FAQ cache for "what is KovaGPT", pricing, login help.
- [ ] Per-prompt dedup (in-flight request map keyed by user+hash) to absorb double-clicks.

### Limits, cooldowns, budgets
- [ ] Guest hard caps (very low messages/day, no images, no uploads, no Deep).
- [ ] Per-feature cooldowns (image gen, file analysis, Deep).
- [ ] IP-based rate limiting in addition to user-id (Cloudflare or table-based).
- [ ] Hard daily + monthly AI budget caps with admin alerts at 70% / 90% / 100%.
- [ ] Per-user daily cost caps; per-request cost cap.
- [ ] Turnstile/CAPTCHA for guest chat once spam appears.

### Files / documents
- [ ] Extract uploaded file text once, chunk + index, send only relevant chunks.
- [ ] Persisted file summary in DB, reused across turns.

### Admin dashboard
- [ ] `ai_request_log` table (user_id, plan, model, feature, in/out tokens, cost_estimate, ts, request_id, ok).
- [ ] `/admin` dashboard for: today/month cost, most expensive users, model breakdown, guest vs free vs paid usage.

### General
- [ ] Confirm logged-in chat search persists; guest chat search must be session-only (clear on reload). Currently `chat-store.ts` uses localStorage for all — needs a guest-mode in-memory variant.
