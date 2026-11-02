# Cloud Browser permissions and interaction cards

Settings → Cloud Browser (`/settings/cloud-browser`) reads actual signed runner availability and account-saved site rules. The existing authenticated `/api/work/browser` route handles `scope=permissions`; requests bind the expected account before reading or writing. Rules use the existing owner-scoped `user_preferences.settings.cloud_browser` document. A compare-and-set on both the old JSON and timestamp prevents overwriting concurrent preferences, including Lockdown Mode. There is no new schema or hosted-auth metadata dependency.

Supported site rules are Ask and Block, matched by exact HTTPS origin. Ask retains the existing one-use Work approval for every model operation. It does not grant general consent. Block is rechecked during command admission, signed browser authority checks, before and after network transfers, and before returning a loaded page. Subdomains are separate. Deleting a rule returns that origin to Ask. No rule overrides the runner's deployment scope, account entitlement, Lockdown Mode, or deletion fence.

The runner advertises `siteRulesVersion: 1`. If any Block rule exists, an older runner cannot continue browser operations; closing a session remains available. Network callbacks send only the destination origin, excluding paths, queries and credentials. Origin checks retain the current owner/run/actor/sequence binding. A block applied during an active session prevents the next page read and terminates an ambiguous session under the existing manager policy.

## Public HTTPS mode

`KOVA_WORK_BROWSER_PUBLIC_WEB=true` is an explicit operator deployment choice. It allows public HTTPS destinations and subresources through the existing broker instead of requiring every origin in `KOVA_WORK_BROWSER_ORIGINS_JSON`. It retains public IPv4 DNS validation, rejection of mixed private/public answers, TLS certificate validation, pinned connection addresses, redirect validation, request/response/session limits, model GET/HEAD restrictions, account authority checks, cancellation and the isolated container. Default behavior remains an origin allowlist. This flag does not activate a runner or provision infrastructure.

## Login, approvals and questions

During owner takeover, a captured password field presents a private entry card with the website domain. Filling sends the password only through the existing private owner browser command; it never becomes a question answer or Work history. The field clears on submission, dismissal, snapshot change, unmount or account invalidation. Filling a password does not submit the website's login form. Existing controls let the owner submit, complete the login, and return control.

Question directives may include two to six distinct short `options`. They pass through the provider, signed receipt and durable execution protocol. The question card presents radio choices plus a free-text answer, with the existing exact question-ID/revision checks and one submission path. Questions without choices remain supported. Provider instructions direct credentials to private takeover rather than questions. Approval cards preserve the exact canonical input, hash, expiration and one-use approval/denial commands.

## Remaining runtime work

This source is not evidence of production activation. Deploy and qualify the web application and compatible Work runner, verify the actual signed readiness, configure the intended browsing scope, then exercise real navigation, account isolation, sign-in, revocation and cancellation. Native isolation acceptance must continue to pass on the actual digest-pinned browser image under `runsc`. No host-browser or hosted-provider fallback is introduced.

Popup windows, JavaScript dialogs, downloads, device permission prompts, persistent logins, and automatic pause-for-login are not implemented by this change. The current driver still blocks or dismisses them; settings explicitly describe that limit. OAuth flows requiring a popup and websites requiring unsupported network features may fail. Supporting those requires a bounded browser protocol and owner-approved interaction lifecycle, not just changing a UI toggle. Public HTTPS mode cannot guarantee compatibility with every website or bypass anti-bot controls.
