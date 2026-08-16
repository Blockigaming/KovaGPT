# KovaGPT ChatGPT-parity UI/UX target

## Product direction

KovaGPT should feel immediately familiar to a current ChatGPT user while remaining distinctly KovaGPT. The reference is ChatGPT's restrained, conversation-first interaction model—not a separate futuristic dashboard, decorative command center, or card-heavy marketing shell.

KovaGPT retains its own name, logo, model terminology, pricing, capabilities, infrastructure, copy, and original implementation. It must not copy proprietary OpenAI source code, protected assets, logos, or trademarks.

## Required parity characteristics

- Minimal conversation-first shell with a stable central reading column.
- Familiar expandable/collapsible sidebar, new-chat control, search, history, Projects, Library, and Settings access.
- Quiet top bar and model selector without decorative status dashboards.
- Composer behavior, proportions, attachment affordances, send/stop states, auto-grow, keyboard behavior, and mobile safe-area handling comparable to ChatGPT.
- Message actions, streaming states, citations, tool activity, artifacts, errors, retries, and long-response handling that remain coherent and truthful.
- ChatGPT-like dialog, menu, sheet, focus, hover, spacing, typography, motion, and responsive conventions.
- No fake controls, placeholder successes, dead routes, unsupported provider claims, or visible capability without a real backend.
- No Voice mode, dictation, microphone control, SpeechRecognition, or voice-specific state.

## Verification matrix

The final candidate must be exercised at 320, 375, 390, 768, 1024, 1280, 1440, and 1728 px across:

- light and dark themes;
- signed-out and signed-in states;
- Chromium, Firefox, and WebKit/Safari-equivalent engines.

Important flows require loading, empty, success, partial-success, disabled, offline, expired-auth, provider-unavailable, rate-limit, permission-denied, retry, cancellation, and unexpected-failure coverage.

## Acceptance standard

A visual difference is acceptable only when it is an intentional Kova product decision, a truthful capability difference, an accessibility improvement, or necessary to avoid copying protected material. “Cooler,” “more futuristic,” or “more premium” does not justify moving away from ChatGPT's interaction model.

Completion requires source-level contracts, browser tests, visual regression evidence, and final production screenshots against the exact deployed release SHA. Source code alone is not visual proof.
