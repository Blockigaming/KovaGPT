# ChatGPT-first KovaGPT product goal

## Product direction

KovaGPT must use the current ChatGPT interaction model as its primary UI/UX reference while remaining an independent Kova product. The target is a quiet, content-first chat workspace rather than a separate dashboard design language.

The implementation should closely match the current reference in:

- application shell and sidebar proportions;
- new-chat, history, search, Images, Plugins, Deep research, Maps, settings, help, and account placement;
- model/intelligence selection;
- transcript width, message rhythm, markdown, actions, and scrolling;
- composer shape, attachment/tool menu, send/stop controls, disclaimer placement, and keyboard behavior;
- menus, dialogs, settings navigation, empty/loading/error states, and mobile sheets;
- responsive behavior, safe areas, focus, reduced motion, and touch targets.

Kova-specific differences are limited to legitimate product identity and behavior: KovaGPT name/logo, plan names and prices, supported models, Kova-owned features, truthful capability limits, legal text, and infrastructure. No OpenAI logo, proprietary source code, private font, copied protected asset, or fabricated capability may be used.

## Current public reference snapshot

Reference checked on August 16, 2026. The signed-out ChatGPT shell currently exposes New chat, Search chats, Images, Plugins, Deep research, Maps, plans, Settings, Help, login copy, a centered greeting/composer, and a legal/AI disclaimer. These labels may change; the live parity harness and dated audit evidence are authoritative, not this prose snapshot.

## Hard product rules

1. Every visible control works end to end or is absent.
2. No Voice mode, microphone dictation, SpeechRecognition, listening state, or voice-specific setting is exposed.
3. KovaGPT never claims a feature, price, privacy behavior, provider, or availability that the deployed system cannot prove.
4. Accessibility wins over visual copying when the reference is weaker.
5. Current ChatGPT behavior is a comparison target, not a license to copy proprietary implementation or assets.
6. Pixel-level acceptance requires reproducible screenshots and computed-style evidence across the required viewport, theme, authentication, and browser matrix.
7. Production completion requires the exact deployed SHA and image digest, not source-only parity.

## Required viewport and state matrix

Widths: 320, 375, 390, 768, 1024, 1280, 1440, and 1728 CSS pixels.

For each applicable width:

- light and dark themes;
- signed-out and signed-in states;
- empty chat, populated transcript, streaming, tool activity, error/retry, temporary chat, menus, dialogs, settings, and secondary pages;
- Chromium, Firefox, and WebKit/Safari-equivalent engines;
- keyboard and touch/coarse-pointer behavior;
- reduced motion and no horizontal overflow.

## Acceptance

The ChatGPT-first goal is complete only when the final candidate passes the semantic parity harness, screenshot/visual review, accessibility gates, and production smoke tests. Intentional Kova differences must be documented; unresolved accidental differences remain release blockers.
