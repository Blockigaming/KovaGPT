# Public pages and legal release review

PR #580 enlarges shared catalog-page spacing, modernizes Settings and adds a searchable directory built from the actual public route catalog. The directory is present through both public layout families, Pricing and Subscribe. Private account routes are not included as public document links.

Terms, Privacy, Refunds, Acceptable Use, Cookies/Storage, Security, Retention, Account Deletion, Service Providers, Accessibility and Support routes already exist. This change adds voice/drawing and public-share disclosures, account eligibility, recurring-payment review and preservation of non-waivable consumer rights. It does not invent a company registration, business address, contractual subprocessor schedule, certification, tax registration, privacy representative or global compliance claim.

Before publishing revised terms, the operator and appropriate legal reviewer must confirm the responsible legal entity/contact details, permitted countries and minimum ages, actual provider contracts and retention, international transfers/rights where applicable, the under-age account response, and required consent flows. Children below 13 must not be onboarded without a separately implemented compliant parental-consent program. A published paragraph does not itself implement COPPA compliance. Applicable security obligations, incident processes and accessibility acceptance need operational evidence.

Subscription checkout must show recurring prices and applicable taxes before an explicit Stripe purchase confirmation. Keep cancellation working in the same verified account. Configure tax collection only after any required tax registration is established; no new Stripe Tax registration or automatic-tax setting is enabled by this PR.

Primary reference material checked November 5, 2026:

- [FTC COPPA FAQs](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [FTC online subscription guidance](https://consumer.ftc.gov/articles/getting-and-out-free-trials-auto-renewals-and-negative-option-subscriptions)
- [Massachusetts 201 CMR 17.00](https://www.mass.gov/regulations/201-CMR-1700-standards-for-the-protection-of-personal-information-of-residents-of-the-commonwealth)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [ElevenLabs API authentication](https://elevenlabs.io/docs/api-reference/authentication)

This is an implementation and coverage record, not a legal opinion or a certification that every jurisdiction's requirements have been met.
