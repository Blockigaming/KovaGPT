import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Azure-origin, edge-validation, and security slices coexist on the current main line", () => {
  const edgeValidation = read(".github/workflows/deploy-cloudflare-production.yml");
  const azureDigestDeployment = read(
    ".github/workflows/ca-kovagpt-dev-AutoDeployTrigger-1724b7ba-d38e-4fd3-95e8-bef7f7fbc290.yml",
  );
  const azureProduction = read("infra/azure/production/main.bicep");
  const originBoundary = read("src/lib/origin-boundary.server.ts");
  const serverEntry = read("src/server.ts");
  const ci = read(".github/workflows/ci.yml");
  const playwright = read("playwright.config.ts");
  const boundedJson = read("src/lib/bounded-json.server.mjs");
  const confirmation = read("src/routes/api/chat/confirm.ts");
  const seoPolicy = read("src/lib/seo-policy.mjs");
  const root = read("src/routes/__root.tsx");
  const tokenBoundary = read(
    "supabase/migrations/20260802003000_google_oauth_tokens_server_only.sql",
  );
  const deepResearch = read("src/lib/ai/deep-research-access.mjs");
  const paymentWebhook = read("src/routes/api/public/payments/webhook.ts");

  assert.match(edgeValidation, /^on:\n  workflow_dispatch:/m);
  assert.match(
    edgeValidation,
    /inputs\.confirmation == 'VALIDATE' && github\.ref == 'refs\/heads\/main'/u,
  );
  assert.match(edgeValidation, /validate-only:/u);
  assert.match(edgeValidation, /permissions:\n  contents: read/u);
  assert.match(edgeValidation, /Azure Container Apps remains the application origin/u);
  assert.doesNotMatch(edgeValidation, /^  (?:push|pull_request|schedule):/m);
  for (const forbidden of [
    /CLOUDFLARE_API_TOKEN/u,
    /CLOUDFLARE_ACCOUNT_ID/u,
    /environment:\n      name: production/u,
    /npm run build/u,
    /wrangler deploy/u,
    /--config dist\/server\/wrangler\.json/u,
    /id-token:\s*write/u,
  ]) {
    assert.doesNotMatch(edgeValidation, forbidden);
  }

  assert.match(azureDigestDeployment, /^on:\n  workflow_dispatch:/m);
  assert.match(azureDigestDeployment, /inputs\.confirm_deploy == true/u);
  assert.match(azureDigestDeployment, /id-token: write/u);
  assert.match(azureDigestDeployment, /azure\/login@/u);
  assert.match(
    azureDigestDeployment,
    /digest_image="\$\{ACR_LOGIN_SERVER\}\/\$\{IMAGE_NAME\}@\$\{digest\}"/u,
  );
  assert.match(azureDigestDeployment, /az containerapp update/u);
  assert.match(azureDigestDeployment, /--image "\$\{\{ steps\.image\.outputs\.digest_image \}\}"/u);
  assert.match(azureDigestDeployment, /\/api\/version/u);
  assert.match(azureDigestDeployment, /"\$runtime_sha" == "\$GITHUB_SHA"/u);
  assert.match(azureProduction, /param imageReference string/u);
  assert.match(azureProduction, /image: imageReference/u);
  assert.match(azureProduction, /activeRevisionsMode: 'Single'/u);
  assert.match(azureProduction, /clientCertificateMode: 'require'/u);
  assert.match(azureProduction, /param cloudflareClientCertificateSha256Fingerprints array/u);
  assert.match(azureProduction, /name: 'KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS'/u);
  assert.equal((azureProduction.match(/tcpSocket:/gu) ?? []).length, 3);
  assert.doesNotMatch(azureProduction, /httpGet:/u);
  assert.match(originBoundary, /request\.headers\.get\("x-forwarded-client-cert"\)/u);
  assert.match(originBoundary, /timingSafeEqual/u);
  assert.match(originBoundary, /new Response\("Forbidden"/u);
  assert.match(serverEntry, /enforceAzureProductionOriginBoundary\(request\)/u);

  assert.match(playwright, /process\.env\.PLAYWRIGHT_PREBUILT === "1"/);
  assert.match(playwright, /usePrebuiltPreview \? \[\] : \["npm run build"\]/);
  assert.match(ci, /PLAYWRIGHT_PREBUILT: "1"/);
  assert.match(ci, /--project=phone-320x700[\s\S]*--project=phone-430x932/);
  assert.match(ci, /--project=tablet-768x1024[\s\S]*--project=tablet-1024x768/);
  assert.match(ci, /--project=desktop-1280x800[\s\S]*--project=desktop-1728x1117/);

  assert.match(boundedJson, /new TextDecoder\("utf-8", { fatal: true }\)/);
  assert.match(boundedJson, /bytesRead \+= value\.byteLength/);
  assert.match(boundedJson, /request_too_large/);
  assert.match(confirmation, /readBoundedJsonObject\(request, 8 \* 1024\)/);

  assert.match(seoPolicy, /return PUBLIC_INDEXABLE_PATHS\.has/);
  assert.match(
    seoPolicy,
    /isPublicIndexableRoute\(pathname, statuses\) \? "index, follow" : "noindex, nofollow"/,
  );
  assert.match(root, /KovaGPT couldn't load this page/);
  assert.doesNotMatch(root, /correlationId|randomUUID|console\.error/);

  assert.match(
    tokenBoundary,
    /REVOKE ALL PRIVILEGES ON TABLE public\.google_oauth_tokens\s+FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(tokenBoundary, /GRANT ALL PRIVILEGES[\s\S]*TO service_role;/);
  assert.doesNotMatch(
    tokenBoundary,
    /DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+public\.google_oauth_tokens/i,
  );

  assert.match(deepResearch, /if \(!authenticated\)/);
  assert.match(deepResearch, /if \(!owner && tier === "free"\)/);
  assert.match(paymentWebhook, /verifyWebhook/);
  assert.match(paymentWebhook, /resolveBillingPlan/);
  assert.match(paymentWebhook, /received: true,[\s\S]*duplicate: result\.duplicate/);
  assert.match(paymentWebhook, /processStripeEvent/);
  assert.match(paymentWebhook, /status: retryableFailure \? 503 : 400/);
});
