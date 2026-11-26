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

Finances starts with connection maintenance off for each linked bank. Enable it and confirm Restore webhook to reset that Item to the KovaGPT callback configured on the server. In Plaid Sandbox, verify that the request is denied with maintenance off, succeeds for the same owner's selected Item after explicit confirmation, and is denied again after disabling maintenance.

Disconnect asks Plaid to remove the Item before deleting Kova's credential. A downgrade does not prevent disconnection. On an uncertain exchange or disconnect outcome, refresh status before starting a new link; the browser does not replay the public token automatically.

## Oura and WHOOP

Create developer applications in the provider owner accounts. Configure the client credentials in the server secret manager and register these exact callbacks:

| Provider | Callback                                                    | Server credential variables                          | Data requested by the UI                                                                                            |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Oura     | `https://kovagpt.com/api/integrations/oauth/callback/oura`  | `OURA_OAUTH_CLIENT_ID`, `OURA_OAUTH_CLIENT_SECRET`   | Basic profile identity, daily summaries, heart health, heart rate, oxygen, workouts, sessions, and tags as approved |
| WHOOP    | `https://kovagpt.com/api/integrations/oauth/callback/whoop` | `WHOOP_OAUTH_CLIENT_ID`, `WHOOP_OAUTH_CLIENT_SECRET` | Basic profile identity, offline renewal, sleep, recovery and cycle summaries                                        |

Each account completes its own consent flow. Users can withhold a requested scope; requested scopes are not treated as proof of Oura's actual grant. The server checks access before reading data. Expiring grants use the existing single-claim refresh mechanism to protect single-use rotating refresh tokens.

The Oura dashboard loads automatically after OAuth approval when its tab is visible. It checks for new cloud data every five minutes while open and shows the latest successful check. Oura's ring and phone determine when data arrives in the cloud. Daily analytics cover up to 90 days, with a shorter window for high-volume heart-rate samples. Data is reduced to approved daily values in memory. Neither connector stores readings or adds them to chat or search. Reads revalidate account ownership, credentials, session, configuration, and Lockdown Mode before returning results. Reconnect existing accounts to review newly offered permissions.

WHOOP's v2 revocation endpoint is supported. Oura disconnection removes local credentials and clearly reports that remote revocation still needs the provider's account settings.

## Apple Health

Open Connections → Health → Apple Health in the KovaGPT iPhone app. Connect Apple Health once and choose which data to share in the system sheet. On later visits, the app resumes the approved connection for the same KovaGPT account and refreshes its daily summaries as HealthKit reports changes while the tab is open. The app preserves Apple data on the device. Connection options disconnects automatic updates or opens an optional local export from Files. Exports stay in the current browser page and keep device sources separate.

Record steps requests separate HealthKit write permission after you review the exact step count and time range on the device. The entry is saved as user-entered data in HealthKit. Verify denial, cancellation, and a confirmed sample using a signed staging build.

The dashboard groups readings such as sleep stages, activity, workouts, mobility, vitals, hearing, nutrition, mindfulness, and supported symptom and cycle logs. Available data depends on the device, iOS version, and granted permissions. Clinical records and raw ECG waveforms need separate handling and are outside this dashboard. The native app requires signing and physical-device testing before distribution.

Verify a permitted category with known data, then disable it in Apple Health and reopen the app. Check that the previous readings clear and that categories without readable data do not report verified access. Disconnect from Kova and reopen under a different Kova account. The iOS build workflow checks an unsigned simulator build. Physical-device acceptance requires an appropriately signed install and known HealthKit data.

## Android Health Connect

The Android companion is in `android/`. Build it using JDK 17, Android SDK 36 and Gradle 8.11.1, or run the Android Health Connect build on GitHub. For a local debug build run `gradle -p android :app:assembleDebug`. Sign a release through the Android distribution process and complete the Health Connect permissions declaration for the app.

Open the Android companion, sign into Kova, and choose Connections → Health → Android Health Connect. Approve the categories you want. The app requests read permissions for steps, sleep, and heart rate. It rechecks grants before each foreground refresh and shows daily aggregates for up to 29 days. The summaries are delivered to the on-device health dashboard for the authorized Kova user. Disconnection clears that user's local opt-in. Use Android Health Connect settings to revoke the app's platform grant.

Record steps requests separate Health Connect write permission after you review the exact step count and time range on the device. The entry uses manual-entry attribution. Include step writing in the Play Console Health Connect permission declaration and verify denial, cancellation, and a confirmed sample with the staging app.

Verify on Android 14 or newer and on a supported device using the Health Connect app. Seed known samples, grant only one category, and verify that only that category appears. Revoke access, switch Kova accounts, background and foreground the companion, and disconnect. An APK build or simulated browser bridge check does not verify real device permission handling.

## Other health services

Oura uses web authorization in Connections. Apple HealthKit and Android Health Connect use their native companion targets and on-device permissions. Other wearables and medical-record services require their own supported APIs, app registrations, approval and consent.

## Acceptance

Use the exact approved staging host from the Azure staging deployment when running physical-device checks before release. The native debug build accepts the company staging domain `staging.kovagpt.com` or a fully qualified host for `ca-kovagpt-staging` on Azure Container Apps. Both bridges trust only the selected HTTPS origin and the Health page. Use a disposable staging account and synthetic device readings.

- On iPhone, set the Debug bundle identifier to `com.kovagpt.health.staging`, set `KOVA_HEALTH_STAGING_HOST` to the approved host without `https://`, and select a signing team with access to HealthKit for that bundle. Run the Debug scheme on the device.
- On Android, run `gradle -p android -PkovaHealthStagingHost=<approved-host> :app:assembleDebug` and install its debug APK. The staging APK uses the package `com.kovagpt.health.staging` and has independent Android Health Connect permissions.

The default and release binaries use `https://kovagpt.com`. The staging builds do not use the production app's saved health consent. CI checks compilation and packaging of both configurations. Sign-off still requires a reading with actual OS permission, denied access for an excluded category, and removal after disconnect or permission revocation on each platform.

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
