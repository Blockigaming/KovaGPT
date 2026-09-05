# Trusted contacts: source package

This package implements voluntary connections between two existing verified KovaGPT accounts. It adds no chat, location, Family, account-control, crisis-detection, or emergency-response access. Creating an invitation is an explicit user action. The recipient must independently review and accept it in their own authenticated account. No email or external notification is sent by this implementation.

## Activation boundary

New invitations, review challenges, and acceptance are disabled unless `KOVA_TRUSTED_CONTACTS_ENABLED=true` and `KOVA_TRUSTED_CONTACTS_POLICY_VERSION=trusted-contact-consent-v1`. Defaults remain off. Production activation requires the owner’s approved eligibility, supported regions, consent wording/version, record-retention schedule, abuse/support handling, and operational policy. Those decisions are not supplied or inferred by this source package. Apply the repository migrations only as part of an authorized release; no live migration or provider configuration was performed here.

Decline, revoke, block, remove-finished-record, and unblock operations remain available if new connections are disabled. The page states what is enabled and that delivery is in-app only. The notification adapter defaults to disabled, requires explicit user action and current invitation/consent state, and has no installed external delivery driver. Enabling a future external driver requires its own approved delivery, cancellation, retention, and operational design.

## Identity and consent

The service-only invitation RPC resolves verified current Auth identities through the narrow private helper migration. It does not require `service_role` to read `auth.users`. The API pins the sender UUID and email to the authenticated current Auth user; neither can be supplied by the request. The recipient’s email identifies an existing eligible account, but email matching alone cannot accept: acceptance also requires that exact authenticated recipient UUID, current verified identities for both recorded emails, a current row revision, an unexpired challenge, and a separate affirmative consent action.

The sender agrees to share their verified account email when inviting. The recipient separately agrees to the connection and sharing their verified account email when accepting. Each consent has its own timestamp and the explicit policy version. Displayed emails are the verified values recorded when the invitation was created; they are not a claim about current email delivery.

Invitations expire after seven days. Reviewing an invitation creates 32 random bytes, returned as a 64-character token in a private, uncached response. Only its SHA-256 digest is stored, with a ten-minute lifetime. The token is held in component memory, cleared on blur/account unmount, and never placed in a URL, log, browser persistence, notification payload, or export. Acceptance, decline, revocation, block, and account deletion clear the stored challenge. Exact revision checks prevent stale commands from restoring a prior state. A repeated accepted command can return its prior successful metadata without consuming the token again or performing a new transition.

## Access, limits, and deletion

RLS permits contact metadata only to the two current parties; blocks are visible only to their creator. Authenticated clients have column-level read privileges that exclude token digests and internal command fingerprints. All writes require service-only RPCs with the authenticated actor supplied by the server. The invoker views preserve underlying RLS. Account export includes party-relative contact metadata and the exporting user’s own block records, never another user’s contact list or token material.

RPCs lock both principals in sorted UUID order using the existing account-deletion advisory-lock key. That serializes connection caps, revision checks, block/revoke, and account deletion. Beginning account deletion revokes all existing links and clears their challenges and command replay metadata before Auth deletion; cancellation does not revive them. New connections and acceptance check both deletion fences. Auth deletion cascades contact and block rows. Removing a finished/expired invitation deletes its shared record for both parties, as the UI explains; active records must first be revoked or declined.

The distributed API limit charges every invitation attempt before resolving its recipient: five per sender per day, including unavailable addresses. Other changes and reads are limited to 30 per minute. The database independently imposes a one-minute invite cooldown, five created invites per day, three outgoing pending invites, ten incoming pending invites, and ten accepted connections per principal. Active lists are bounded by those caps; history shows the latest 50 finished records, and the user’s block list is paginated in deterministic pages of 100. API bodies are limited to 4 KiB, identifiers/revisions are validated, RPCs have a five-second SQL timeout and eight-second abort deadline, and browser transport is bounded and pinned to the current account. Recipient lookup and database errors use generic responses without private details.

Unblock commands also carry the immutable block-row UUID. Removing and later recreating a block therefore cannot make a delayed old unblock command valid again, even if the recreated row starts at revision one.

## Local verification

Focused SQL tests execute the real migration and private Auth helpers with actual roles and no service-role Auth table SELECT grant. They cover party RLS, private blocks, token-column denial, export exclusions, consent and identity failures, single-use challenges, exact revisions, expiry/caps, blocking, account-deletion cancellation, and Auth cascades. Runtime tests execute the real route with controlled transport dependencies to verify authentication, input bounds, activation, pre-lookup rate limits, server-owned sender identity, digest-only RPC inputs, error redaction, and RLS read pagination. The notification policy tests prove its default-disabled behavior and rejection of stale consent state.
