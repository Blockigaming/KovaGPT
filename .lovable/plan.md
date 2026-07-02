# Refactor Plan

You picked all four clusters. This is ~2 days of focused work; I'll ship it in four sequenced phases so each is verifiable in the preview before the next lands. Each phase ends in a working app.

## Phase 1 — Critical bug fixes (ship first)

**1a. Voice session "Could not start"**
- Read `src/routes/api/realtime-session.ts` + `VoiceMode.tsx` to identify the actual failure (likely OPENAI_API_KEY / tier gate / model name). Add specific error surfacing so we stop guessing.
- Verify with `invoke-server-function` and `server-function-logs`.

**1b. Image generation broken**
- Audit `src/routes/api/generate-image.ts` + the chat's image-intent detection. Fix the pipeline (likely SSE parsing or model body shape drift).

**1c. LLM instruction adherence (negative constraints)**
- System prompt in `src/routes/api/chat.ts`: add an explicit rule that user negative constraints ("don't generate an image", "don't search") override tool triggers for the remainder of the turn.
- Fix intent parser so keywords like "image" inside a *denial* don't trigger the image tool. Use a lightweight classifier pass or regex negation guard.

## Phase 2 — Voice Mode UX overhaul

Depends on 1a. In voice session:
- Hide the "KovaGPT" hero + landing centerpiece; render the standard chat transcript instead. User speech = sent bubble, assistant speech = received bubble (already partially wired via `onTurn`).
- Move ChatInput to the bottom.
- Center a large NovaLogo above the input with a continuous wave/pulse animation driven by an `AnalyserNode` on the mic stream + on the incoming audio element (real audio-reactive scale, not just CSS pulse).
- Barge-in: on `input_audio_buffer.speech_started`, send a `response.cancel` event over the data channel and mute the remote audio element until the next `response.created`.

## Phase 3 — Sidebar / Modes / Library

- **Scheduled Tasks**: gate the nav item behind `useTier()` — hide for `free`.
- **Mode selector**: remove the Kova icon in the trigger; keep text only. Verify `ModelSelector.tsx`.
- **Library responsive**: currently width-capped. Switch to a fluid grid (`grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`) with a `max-w-7xl` container instead of a fixed narrow column.
- **Library query perf**: run `supabase--slow_queries`; expected fixes: add index on `user_library_items(user_id, created_at desc)`, paginate/limit initial load, drop N+1 by joining images in one query.

## Phase 4 — Settings, Family Sharing, Integrations

**4a. Settings redesign**
- Rework `SettingsDialog.tsx` into a two-pane layout (left rail sections: Account, Appearance, Voice, Usage, Family, Integrations, Danger). Cleaner typography, glass surfaces consistent with the app's dark aesthetic. No feature removal — pure UI polish.

**4b. Persistence audit**
- Every setting currently in localStorage: mirror to a new `user_preferences` table (theme, voice, mode, personality sliders). Load on sign-in, write-through on change. Local-only for guests.

**4c. Usage Today tracker fix**
- Read `try_increment_daily_usage` (visible in db functions) — the "latest row" logic is buggy: it uses `ORDER BY updated_at` instead of `WHERE usage_date = today`, so a stale row from yesterday can block today's writes. Rewrite to key strictly on `(user_id, usage_date=today)`. Update the client tracker to sum from the same source of truth.

**4d. Family Sharing (new feature — "make it perfect")**
My interpretation, tell me if this is wrong before I build it:
- Plus/Pro subscribers get a "Family" section in Settings.
- Owner generates an invite link (single-use, 7-day expiry, max 5 accepted invites).
- Invitees who sign up via the link are linked to the owner's plan → inherit Plus features + share the daily quota pool (or independent quotas — pick one, I'd suggest **independent** so one member doesn't starve another).
- Owner sees member list with remove button.
- New tables: `family_groups`, `family_members`, `family_invites`. RLS scoped so members only see their own group.
- Subscription tier check in `useTier()` treats "member of family group with active Plus owner" as Plus.

**4e. Red destructive buttons**
- Sign Out + Remove Connection → `bg-destructive text-destructive-foreground` (semantic token, already themed red).

**4f. Integrations privacy investigation (report-before-changing)**
- I'll read whatever integration code exists (Plaid, school portals, etc.) and post findings + a proposed scoping plan back to you *before* touching auth flows. No blind changes to OAuth.

---

## Confirm before I start

1. Kick off with **Phase 1** now?
2. Family Sharing scope above — good, or adjust (quota pool vs independent, member cap, who can invite)?
3. Integrations phase: OK that I'll read + report before changing anything?