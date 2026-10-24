# Mobile reference and Free entitlement revision

Owner direction: phone reference supplied October18,2026; Free has no Cloud browser, two uploads per day and three image generations per day; guests sign in before uploading or creating files/images. Paid plan limits are unchanged.

## Interface

Populated phone conversations use a compact floating composer pill. It expands for multiline input and attachments, retains44px controls and existing voice→Send/Stop behavior. New chat, tablet and desktop composers retain their prior layout. The phone menu is upper-right, translucent, title-led and edge-clamped. Share, Pin/Unpin, actual uploaded files, local Find in chat, Archive and Delete remain meaningful. Secondary Rename/Plugins/project-copy actions are in More options. No unsupported Remove from project action is invented.

## Source enforcement

Free explicit paid/Thinking mode requests are rejected before provider/quota work; ordinary Free chat retains the existing supported basic route. Model availability and actual deployment remain separately verified by Models/Terminal. No global model pins or paid behavior changed.

Guest attachment requests are rejected at the API and composer entry paths. Existing authenticated file creation and image endpoints retain server authentication. Free browser history can be inspected, but active browser controls require a paid tier. Verified owners can still close an existing session after a downgrade to avoid orphaning resources.

Uploads use server-derived content fingerprints and the existing atomic UTC-day usage counter. Chat and Library auto-save share the same identity for an unchanged file, so one document is not charged twice. Referencing a retained Library file is not another upload. Project upload reservations keep their existing atomic counter. Generated file content is distinct from client uploads. Local counters are account-scoped hints and reset at midnight UTC; server counters remain authoritative.

## Required source-only database migration

supabase/migrations/20261018163000_daily_upload_identity.sql adds a private service-role-only fingerprint ledger and reservation function. It was executed in offline PGlite fixtures, not against any live account. Tests cover duplicate requests, two-file exhaustion, competing final-slot submissions, account isolation, UTC rollover and denied authenticated access. PGlite serializes its embedded connection; this is not live multi-connection load certification. Existing SQL row locking is preserved.

Terminal must review/apply the additive migration before activating this source. Missing or indeterminate RPC responses fail closed. Reconcile current production migrations and obtain applicable release authorization; do not apply from this review package. Rollback must restore a verified compatible application revision while retaining the ledger/counters; dropping quota data is not required or authorized. No key, API activation, database write, deployment or paid call occurred during this task.
