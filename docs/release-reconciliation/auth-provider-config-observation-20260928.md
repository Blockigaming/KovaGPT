# Production Auth configuration observation — September 28, 2026

Read-only dashboard inspection of the selected `KovaGPT` production project, connector ref `mfbycmbjygcfkrsuepxf`. This page records visible configuration, not secret values or a tested recovery configuration.

| Area | Observed production state |
| --- | --- |
| Sign-in methods | Email and Google enabled; Phone, SAML, Web3, and other listed social providers disabled; no custom providers listed. |
| Signup | New signups and email confirmation enabled; anonymous sign-ins and manual account linking disabled. |
| Email security | Secure email change enabled; secure password change, current-password requirement, and leaked-password screening disabled. Email OTP/link expiry is 3600 seconds with eight-digit OTP. |
| Google | OAuth client configuration present in the dashboard; nonce bypass and users-without-email options disabled. Client ID and secret are not recorded here. |
| Redirects | Site URL `https://kovagpt.com`; allowed redirects `https://kovagpt.com/~oauth/callback` and `https://kovagpt.com/reset-password`. |
| MFA | TOTP enabled, maximum ten factors per user; SMS MFA disabled. AAL1 sessions are limited to 15 minutes pending factor verification. |
| Sessions | Access token expiry 3600 seconds; refresh-token replay detection enabled with a ten-second reuse interval. Single-session and custom time-box/inactivity settings are unavailable on the Free plan. |
| Email delivery | Custom SMTP enabled with host `smtp.resend.com`, port 465, sender name `KovaGPT`, and a 60-second per-user interval. Sender address, SMTP username, and password are omitted. |

The dashboard also exposes email template, rate limit and other security settings; this observation does not certify their full recoverability or the external Google and Resend account settings. Credentials, template bodies, protected runtime settings, API/Data API and Realtime configuration, and any relevant webhooks require a private recovery inventory. Recheck this live state before migration. **M17/M18 stay open; Azure migration remains 14/24 accepted.**
