import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("externally merged production and security slices coexist on the current main line", () => {
  const deployment = read(".github/workflows/deploy-cloudflare-production.yml");
  const vite = read("vite.config.ts");
  const boundedJson = read("src/lib/bounded-json.server.mjs");
  const confirmation = read("src/routes/api/chat/confirm.ts");
  const seoPolicy = read("src/lib/seo-policy.mjs");
  const root = read("src/routes/__root.tsx");
  const tokenBoundary = read(
    "supabase/migrations/20260802003000_google_oauth_tokens_server_only.sql",
  );
  const deepResearch = read("src/lib/ai/deep-research-access.mjs");
  const paymentWebhook = read("src/routes/api/public/payments/webhook.ts");

  assert.match(deployment, /^on:\n  workflow_dispatch:/m);
  assert.match(
    deployment,
    /inputs\.confirmation == 'DEPLOY' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(deployment, /environment:\n      name: production/);
  assert.match(deployment, /--config dist\/server\/wrangler\.json/);
  assert.doesNotMatch(deployment, /^  (push|pull_request):/m);

  assert.match(vite, /preset: "cloudflare-module"/);
  assert.match(vite, /output:\s*{\s*dir: "dist"/s);
  assert.match(vite, /serverDir: "dist\/server"/);
  assert.match(vite, /publicDir: "dist\/client"/);

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
  assert.match(paymentWebhook, /processStripeEvent/);
  assert.match(paymentWebhook, /received: true, duplicate: result\.duplicate/);
});
