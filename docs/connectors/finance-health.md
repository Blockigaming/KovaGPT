# Finance and health connections

The Connections page includes bank and health account controls. Runtime configuration and provider consent determine which controls are usable. A successful code build is not proof of a production connection.

## Plaid

Register `https://kovagpt.com/apps` as the web OAuth redirect. Configure the following server environment values using the deployment's secret manager:

| Variable                         | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `PLAID_CLIENT_ID`                | Your own Plaid developer application               |
| `PLAID_SECRET`                   | Secret for the selected environment                |
| `PLAID_ENV`                      | `production` for the production deployment         |
| `PLAID_WEBHOOK_URL`              | `https://kovagpt.com/api/finances/webhook`         |
| `PLAID_REDIRECT_URI`             | `https://kovagpt.com/apps`                         |
| `KOVA_FINANCE_REGIONS`           | Supported country codes; defaults to `US`          |
| `CONNECTOR_TOKEN_ENCRYPTION_KEY` | Existing 32-byte base64 application encryption key |

Production refuses Sandbox credentials. Complete Plaid's plan selection and business verification in the owner account, then obtain the provider's production access. An unfinished application is not an approval request under review. Enabling live Plaid products can incur provider usage charges; select the plan and products deliberately.

Connect bank launches Plaid's official web SDK. The browser exchanges its public token through Kova's authenticated server. The server encrypts Item credentials before storing them. Bank OAuth returns reuse only the same owner's unexpired short-lived Link token in session storage. Access tokens remain server-side.

Read balances and transactions fetches current account balances and at most 100 transactions from the preceding 30 days. These are explicit live reads, rather than a background transaction import. `limited` identifies a truncated result. Plaid's positive transaction amounts represent spending and negative amounts represent money received. Investment holdings and liabilities are not imported by this reader.

Webhooks verify ES256 signatures using Plaid's fixed public-key endpoint, enforce a five-minute issuance limit, and compare the SHA-256 of the original body. Valid known-Item notifications are acknowledged only after a durable, deduplicated receipt is stored. Provider payloads and raw Item IDs are omitted from receipts. Unknown or disconnected Items do not trigger private-data reads. This notification receipt does not claim a transaction sync or advance a Sync cursor.

Disconnect asks Plaid to remove the Item before deleting Kova's credential. A downgrade does not prevent disconnection. On an uncertain exchange or disconnect outcome, refresh status before starting a new link; the browser does not replay the public token automatically.

## Oura and WHOOP

Create developer applications in the provider owner accounts. Configure the client credentials in the server secret manager and register these exact callbacks:

| Provider | Callback                                                    | Server credential variables                          | Data requested by the UI                                                     |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Oura     | `https://kovagpt.com/api/integrations/oauth/callback/oura`  | `OURA_OAUTH_CLIENT_ID`, `OURA_OAUTH_CLIENT_SECRET`   | Basic profile identity and `daily` sleep, readiness and activity summaries   |
| WHOOP    | `https://kovagpt.com/api/integrations/oauth/callback/whoop` | `WHOOP_OAUTH_CLIENT_ID`, `WHOOP_OAUTH_CLIENT_SECRET` | Basic profile identity, offline renewal, sleep, recovery and cycle summaries |

Each account completes its own consent flow. Users can withhold a requested scope; requested scopes are not treated as proof of Oura's actual grant. The server checks access before reading data. Expiring grants use the existing single-claim refresh mechanism to protect single-use rotating refresh tokens.

Read summaries fetches a bounded page for the past seven days and exposes selected summary fields. Health summaries are not automatically added to chat, embedded, indexed, or stored as imported records. Reads revalidate account ownership, credentials, session, configuration and Lockdown Mode before returning results. Private data is discarded if the grant changes during the read.

WHOOP's v2 revocation endpoint is supported. Oura disconnection removes local credentials and clearly reports that remote revocation still needs the provider's account settings.

## Apple Health

The KovaGPT Health iPhone project lives at `ios/KovaHealth.xcodeproj` and requires iOS 17 or later. The app requests read access to step counts and displays daily totals across seven calendar days, including today. Apple Health may return no readings when step data is unavailable or access is denied.

For device testing, open the project in Xcode, select the authorized Apple Developer team under Signing & Capabilities, and confirm the HealthKit capability and bundle identifier. Build on a physical iPhone. The unsigned simulator build checks that the project compiles. Device signing and permission tests are separate.

In the iPhone app, tap **Read step totals**, complete the Apple Health prompt, and choose **Save report on this iPhone**. In KovaGPT **Connections → Health**, tap **Open Apple Health report**. In Files, select **On My iPhone → KovaGPT Health → Reports → Apple Health Steps.kovahealth**. Safari reads the compact report locally. Daily totals stay in the current tab, and **Clear report** discards them. Use **Delete saved report** in the iPhone app to remove the device copy.

The browser sends no report to a server and has no stored provider token or background sync. The report excludes other HealthKit metrics, source identifiers, and individual records. The app excludes the report directory from backups. Test the flow with consent granted, consent withheld, access revoked, no step data, report removal, and Kova account switching. Verify that opening a report sends no network request.

If the team uses Xcode Cloud for TestFlight, first create the app record in App Store Connect. Create the workflow from Xcode and grant the Xcode Cloud GitHub app access to this repository. A signed iPhone read and a browser import are required before calling the feature available.

## Other health services

Oura and WHOOP are the implemented web adapters. Other wearables and medical-record services require their own supported APIs, app registrations, approval and consent. Android Health Connect requires a mobile application and platform permissions.

## Acceptance

For each enabled provider, verify real owner consent, a successful read through Kova, denial or revocation, credential expiry, account switching and disconnection. A mocked protocol/browser test is a source check, not live provider acceptance. Keep unconfigured providers disabled until their prerequisites are actually met.

## Primary references

- [Plaid Link Web SDK and CSP](https://plaid.com/docs/link/web/)
- [Plaid webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)
- [Plaid Transactions API](https://plaid.com/docs/api/products/transactions/)
- [Oura authentication](https://cloud.ouraring.com/docs/authentication)
- [Oura API v2](https://cloud.ouraring.com/v2/docs)
- [WHOOP OAuth](https://developer.whoop.com/docs/developing/oauth/)
- [WHOOP API v2](https://developer.whoop.com/api/)
- [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [Health Connect setup](https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started)
