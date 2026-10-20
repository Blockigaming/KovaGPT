# Twilio SMS setup

Twilio Programmable Messaging is the selected SMS transport. Resend remains the
email provider. This source adds a server-only transport; it does not enable
sending, add an SMS authentication method, or replace Kova session authority.
Email/password, passkeys and authenticator-app work can proceed independently.

## Current implementation

`src/lib/twilio-sms.server.mjs` loads no credential values while disabled. Its
sender uses the fixed Twilio Messages REST endpoint, API-key authentication and
one Messaging Service. It permits international E.164 destinations and one
GSM-7 segment per call, using an ASCII subset with extension characters counted
as two septets. Each explicit send has a bounded response size and deadline,
limits Twilio's outgoing queue window to 60 seconds, rejects redirects and
makes no automatic retry. A timeout or unknown POST result remains uncertain;
a caller must not blindly send again. That queue window does not establish a
code's lifetime or the recipient's possession of a verified phone number. The
segment limit applies to the submitted body, not an all-in billing guarantee;
service-side content changes, carrier charges and account fees still need
qualification.

Provider acceptance is not confirmed inbox delivery. There is no public SMS
route, background dispatcher, automatic fallback, status webhook or live-send
CLI in this change. No account Auth Token is required by this transport.

## Private configuration

Use a dedicated staging Messaging Service and its approved sender pool. Use a
Twilio US1 API key for this fixed API origin. The application needs **one secret**
for Twilio; the three SIDs below identify resources and are not secret keys.
Keep the secret server-side and out of chat, source files and browser bundles.

| Runtime variable               | Value or private binding                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| `KOVA_SMS_PROVIDER`            | `twilio`                                                           |
| `KOVA_SMS_SEND_ENABLED`        | `false` until an applicable live-SMS approval and Auth integration |
| `TWILIO_ACCOUNT_SID`           | Intended account identifier, beginning `AC`                        |
| `TWILIO_API_KEY_SID`           | API-key identifier, beginning `SK`                                 |
| `TWILIO_API_KEY_SECRET`        | Private secret reference `twilio-api-key-secret`                   |
| `TWILIO_MESSAGING_SERVICE_SID` | Dedicated staging service identifier, beginning `MG`               |

These are proposed configuration bindings, not a record of applied Azure
settings. No `VITE_` or other public variable may contain these credentials.
Use a Restricted key permitting Message creation when supported; do not grant
account/key administration. Validate its actual permission privately before a
live send. Region credentials must match the US1 endpoint used by this adapter.

## Owner setup sequence

1. Sign in to the intended Twilio account, or complete account creation in the
   secure browser. The owner handles new-password entry and terms acceptance.
2. Review Programmable Messaging SMS pricing and registration costs for the
   intended destinations. US sender requirements and recurring number/campaign
   charges must be included. Do not treat a message's base rate as an all-in cap.
3. Create a Messaging Service named `KovaGPT Staging SMS` and choose the
   verification-code use case. Provisioning a paid sender, registering a paid
   campaign, funding the account or enabling auto-recharge requires the owner's
   applicable purchase decision. Retain Kova's purpose and brand accurately.
4. Add an approved SMS sender to that service's pool and finish the applicable
   sender registration/verification. Enable only intended destination countries
   in SMS geographic permissions. A service without an eligible sender is not
   send-ready.
5. Create the sending API key in the same account and region. Privately store
   its secret under `twilio-api-key-secret`; record the Account SID, API-key SID
   and Messaging Service SID in staging configuration. Never paste the secret
   into chat. No account Auth Token or second metadata key is needed for this
   sender.
6. Leave `KOVA_SMS_SEND_ENABLED=false`. Apply runtime changes only through the
   qualified staging change path, because a new revision can activate an app.

Twilio Verify is a separate managed verification product and is not called by
this transport. Choosing raw SMS does not by itself implement secure OTP
generation, storage, checking, enrollment or account recovery.

## SMS Auth work still required

Owned Auth has TOTP MFA/recovery codes and WebAuthn passkeys; its existing MFA
challenge RPCs are TOTP-only. It has no owned verified-phone factor or SMS
challenge lifecycle. Existing `settings.phone` is not an authenticated phone
credential. Binding Twilio secrets cannot enable SMS login by itself, and a
Message SID or provider acceptance must never issue AAL2.

Before exposing SMS MFA, add and qualify:

- Fresh primary reauthentication and owner/session-bound phone enrollment.
- Stored verified destinations, purpose-bound expiring challenges, protected
  code storage, single-use consumption and atomic attempt/resend limits.
- Distributed per-account and per-destination abuse/spending controls, including
  duplicate suppression and an uncertain-send state that cannot silently retry.
- Explicit login method selection, authoritative SMS completion, removal and
  recovery handling. Preserve existing TOTP/passkey guarantees and email notices.

No new SMS flow or destination has an approved live-send allowance in this
change. The existing Auth US$5 and five-email allowance are unchanged; SMS costs
must be authorized separately. No build, activation, deployment or SMS is
authorized by a configuration flag or passing mocked test.

## Verification and references

Run the affected transport tests with:

```sh
node --test tests/unit/twilio-sms.test.mjs
```

Mocked fetch tests exercise the real request/response adapter without provider
credentials or network access. New Twilio Console accounts cannot create the
legacy test credentials; trial credentials can deliver real messages and are
not a substitute for offline mocks. The current SMS trial restricts recipients,
message templates and permitted request fields. Its documented API flow does
not permit this adapter's custom body and Messaging Service parameters. Free
signup is therefore not live qualification of this transport; review any paid
upgrade and sender costs before proceeding to real use.

Official references reviewed on 2026-10-20:

- [Messages resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [API authentication](https://www.twilio.com/docs/usage/requests-to-twilio)
- [Messaging Services](https://www.twilio.com/docs/messaging/services)
- [Restricted API keys](https://www.twilio.com/docs/iam/api-keys/restricted-api-keys)
- [SMS geographic permissions](https://www.twilio.com/docs/messaging/guides/sms-geo-permissions)
- [US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us)
- [Test credentials](https://www.twilio.com/docs/iam/test-credentials)
- [Current SMS trial restrictions](https://www.twilio.com/docs/usage/trials/try-out-sms)
