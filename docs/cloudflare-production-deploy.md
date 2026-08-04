# Manual Cloudflare production deployment

This repository has a zero-Lovable-credit deployment path that builds and deploys the generated Nitro Cloudflare Worker through GitHub Actions and Wrangler. It is intentionally manual: pushes, pull requests, and merges do not trigger it.

The workflow deploys a Worker script only. It does not create or change DNS records, Cloudflare routes, custom domains, zones, certificates, environment protection rules, or runtime secrets.

## One-time owner setup

Complete this checklist in GitHub and the Cloudflare account that will own production:

- Create a GitHub environment named `production`.
- Protect the environment with required reviewers and prevent self-review where the repository plan supports it.
- Restrict the environment's deployment branches to `main`.
- Add the environment secret `CLOUDFLARE_API_TOKEN`. Scope it to the target account with only the permissions needed to edit Workers scripts and assets.
- Add the 32-character hexadecimal Cloudflare account ID as the environment variable `CLOUDFLARE_ACCOUNT_ID` for that same account.
- Choose the production Worker script name and add it as `KOVA_CLOUDFLARE_WORKER_NAME`. Use a 1-63 character DNS label containing only letters, numbers, and internal dashes so the pre-cutover `workers.dev` health check is available. The name identifies the Worker deployment; it does not bind `kovagpt.com`.
- Add the browser-safe Supabase project URL as the protected environment variable `VITE_SUPABASE_URL`.
- Add the browser-safe Supabase publishable key as the protected environment variable `VITE_SUPABASE_PUBLISHABLE_KEY`. Use an `sb_publishable_...` key or the project's legacy anonymous JWT only. Never use a `service_role` key or `sb_secret_...` value; these values are embedded in the browser bundle.
- Configure the application's runtime secrets and variables on that Worker in Cloudflare before traffic cutover. Do not put their values in the repository or workflow logs. The deploy command uses Wrangler's [`--keep-vars`](https://developers.cloudflare.com/workers/wrangler/commands/workers/) option so dashboard-managed variables are preserved; Cloudflare documents that Worker secrets are not deleted by deployment.
- Confirm the Cloudflare account owns or can manage the DNS zone intended for the custom domain.

## Manual deployment

1. Review and merge the desired revision through the normal repository process.
2. Open **Actions > Deploy KovaGPT to Cloudflare production > Run workflow**.
3. Select `main`, enter `DEPLOY`, and start the workflow. The job refuses every other ref.
4. Approve the protected `production` environment when GitHub requests approval.
5. The workflow installs locked dependencies, rejects missing or unsafe public Supabase build configuration, runs the production build, validates `dist/server/index.mjs` and `dist/server/wrangler.json` in local workerd, then runs Wrangler against that generated config.
6. Record the Git commit and Cloudflare Worker version shown by the completed deployment.

The workflow fails before deployment if the API token is missing, if the account ID or Worker name is missing or malformed, or if the public Supabase build configuration is missing or unsafe. It never falls back to the root `wrangler.jsonc` or raw `src/server.ts` entry.

## Health verification before DNS cutover

Use the Worker preview or `workers.dev` hostname shown by Cloudflare. Do not change production DNS until both checks pass:

- `GET /api/health` returns HTTP 200 JSON with `ok: true`, `app: "KovaGPT"`, and `Cache-Control: no-store`.
- `GET /` returns HTTP 200 HTML containing the KovaGPT shell and not the branded "This page didn't load" error.

Also complete an authenticated smoke test with the production runtime secrets configured. The build succeeding does not prove external auth, database, billing, or AI-provider credentials are present.

## Custom domain and DNS cutover

Deployment alone cannot bind `kovagpt.com`. The owner must configure the domain in the target Cloudflare account after the Worker is healthy:

1. Verify that the `kovagpt.com` zone and the intended DNS records are controlled by the target account. Preserve the existing origin and its records until verification is complete.
2. In the deployed Worker's **Settings > Domains & Routes**, add the required [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) or route. Configure `kovagpt.com` and `www.kovagpt.com` separately if both should serve KovaGPT.
3. Review Cloudflare's proposed DNS and certificate changes before confirming them. Cloudflare cannot add a Custom Domain on a hostname that already has a CNAME record; plan the cutover and rollback before replacing any existing record.
4. After Cloudflare reports the certificate and route active, verify `/api/health` and `/` on every production hostname from an external network.
5. Keep the previous origin available during the observation window. If health checks regress, remove or roll back the new route/domain and restore the prior DNS target.

The exact domain operation depends on the owner's Cloudflare zone, DNS, and account configuration. This workflow deliberately does not guess or mutate that configuration.

## Rollback

Use Cloudflare's Worker version rollback when available, or revert to a previously reviewed good commit on `main` and manually run the workflow. Re-run the health and authenticated smoke checks after rollback. There is no automatic deployment or automatic DNS rollback.
