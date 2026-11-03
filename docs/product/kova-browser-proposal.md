# Kova Browser proposal for owner review

Status: proposed behavior, not a claim that production browser execution is available.

Kova Browser would run a separate, isolated browser session on infrastructure operated for Kova. Kova's agent would use the configured OpenAI integration to read pages, click controls, fill forms and carry out approved multi-step tasks. The OpenAI API integration does not grant access to ChatGPT's private browser infrastructure.

The conversation would show a compact browser panel with the current website, its icon, progress, a session preview, and Stop. Progress would describe actual execution events, for example “Searching the store for your item,” “Comparing the available options,” or “Waiting for you to sign in.” Source links would remain available beside the answer. Search results and browser visits would be labelled separately: a search result is not proof that Kova opened or read the whole page.

Website rules would live in Settings → Cloud Browser. Each site could require approval for every interaction, allow reading only, or allow a specified set of actions. New sites would ask first. Account ownership, current permissions and session expiry would be enforced on every operation.

When login, a verification code, or another private input is required, Kova would pause and offer secure user takeover. Passwords and session cookies would stay outside chat and model-visible logs. Before purchases, sending messages, submitting forms or deleting data, Kova would show the proposed action and request the appropriate confirmation. Stop would cancel pending work and release the session.

Production acceptance requires a qualified isolated host, authenticated owner-bound execution, secure takeover, working permission prompts, verified cancellation/cleanup, and an actual end-to-end OpenAI agent/browser run. Existing integration code alone does not establish those outcomes.
