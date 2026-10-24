# KovaGPT specification 400 candidate

This is a separate interactive candidate based on the owner-selected 9cc checkpoint. The original file remains separate. Current light/dark colors are preserved. Owner visual acceptance and publication remain pending.

## Launch

Extract the entire ZIP. Node.js 24 is required. No installation or provider credentials are needed.

Keep these running in two terminals from the extracted folder:

1. `node serve.mjs`
2. `node private-http-review.mjs --port=4191`

Open `http://127.0.0.1:4191/__local-review` in your browser. Choose account, theme, route, state, scenario and CSS review size. Use Open/reset to create a disposable synthetic session. Hide review controls for the product view. Stop both servers with Ctrl+C.

The ordinary-browser path does not need Playwright. The optional `review.mjs` launcher is separate and requires an available installed browser.

## State and verification

SOURCE.json identifies the exact source/tree/build. Verification applies only to the states and revisions recorded in the accompanying acceptance evidence, not every conceivable device or service. The 400 requirements are an acceptance checklist, not 400 pages. Added public/review surfaces use existing Kova content and clearly indicate unavailable services or unapproved facts.

All review accounts and writes are disposable local fixtures. No real account, AI, payment, email, provider connection, browser session, or scheduled execution is created. Never enter credentials or real private content into fixtures. Changing account/reset clears this review origin's prior sample state.

Useful scenarios: default for ordinary chat; chat-outputs for sample artifacts; chat-copy-task for prose/code copy surfaces and a simulated persisted-task result; chat-task-unconfirmed for a missing receipt; tasks-editor for disposable task editing. The task example is synthetic and does not prove a live chat-to-schedule producer.

Preferences are account-scoped on this device; cross-device sync is unavailable. Usage reset display must retain the server's UTC accounting contract. Unsupported services and controls must not be treated as activated by a preview.

Full source and cumulative patches are preserved separately. This runtime intentionally excludes raw source archives and internal migration/security documents. No deployment or API setup is performed by opening it.
