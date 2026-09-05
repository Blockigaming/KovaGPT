import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("new migrations avoid unsupported CREATE POLICY IF NOT EXISTS syntax", () => {
  for (const path of [
    "supabase/migrations/20260721211500_deep_research_runs.sql",
    "supabase/migrations/20260722123000_connectors_tasks_sharing_settings_audit.sql",
    "supabase/migrations/20260722130000_product_completeness_reliability.sql",
  ]) {
    const sql = read(path);
    assert.doesNotMatch(
      sql,
      /create\s+policy\s+if\s+not\s+exists/i,
      `${path} uses unsupported policy syntax`,
    );
  }
  const connectors = read(
    "supabase/migrations/20260722123000_connectors_tasks_sharing_settings_audit.sql",
  );
  assert.match(connectors, /drop policy if exists "connected accounts owner read"/i);
  assert.match(connectors, /create policy "audit owner read"/i);
});

test("Playwright starts the built preview app before browser tests", () => {
  const config = read("playwright.config.ts");
  assert.match(config, /webServer:\s*{/);
  assert.match(config, /npm run preview -- --host 127\.0\.0\.1 --port 8080/);
  assert.match(config, /url:\s*"http:\/\/127\.0\.0\.1:8080"/);
});

test("retired compatibility email routes are absent and support delivery remains fail closed", () => {
  const support = read("src/routes/api/public/help-submit.ts");
  for (const path of [
    "src/routes/lovable/email/transactional/send.ts",
    "src/routes/lovable/email/auth/preview.ts",
  ]) {
    assert.equal(existsSync(path), false, path);
  }
  assert.match(support, /KOVA_EMAIL_QUEUE_ENABLED/u);
  assert.match(support, /Email delivery is not configured/u);
  assert.match(support, /rpc\("enqueue_email"/u);
  assert.doesNotMatch(support, /\/lovable|legacyLovable/iu);
});

test("MCP validates Supabase bearer tokens and uses the real user id for created tasks", () => {
  const mcp = read("src/lib/mcp/index.ts");
  assert.match(mcp, /supabase\.auth\.getUser\(token\)/);
  assert.match(mcp, /isAuthenticated:\s*\(\) => Boolean\(token && userId\)/);
  assert.match(mcp, /const userId = ctx\.getUserId\(\)/);
  assert.match(mcp, /created_by: userId/);
  assert.doesNotMatch(mcp, /created_by:\s*ctx\.getUserId\(\) \|\| null/);
});

test("image generation validates n before quota and supports exactly one image", () => {
  const route = read("src/routes/api/generate-image.ts");
  const workflow =
    read("src/lib/multimodal/image-request-policy.mjs") +
    read("src/lib/multimodal/image-request-policy.d.mts");
  assert.ok(route.indexOf("normalizeImageSettings(parsed)") < route.indexOf("enforceQuota("));
  assert.match(workflow, /n:\s*1;/);
  assert.match(workflow, /input\.n !== undefined && input\.n !== 1/);
  assert.match(workflow, /One image is supported per request/);
  assert.match(workflow, /n:\s*1,/);
});

test("sitemap excludes private and noindex workflows", () => {
  const sitemapPolicy = read("src/lib/seo-policy.mjs");
  for (const path of [
    "/checkout/return",
    "/summary",
    "/audit-log",
    "/projects",
    "/scheduled-tasks",
    "/write",
    "/apps",
    "/library",
    "/reset-password",
    "/unsubscribe",
  ]) {
    assert.equal(
      sitemapPolicy.includes('{ path: "' + path + '",'),
      false,
      path + " must not be advertised in the public sitemap",
    );
  }
  for (const path of ["/", "/pricing", "/study-assistant", "/privacy"]) {
    assert.equal(
      sitemapPolicy.includes('{ path: "' + path + '",'),
      true,
      path + " should remain in the public sitemap",
    );
  }
});

test("study assistant only promises upload formats supported by the composer", () => {
  const study = read("src/routes/study-assistant.tsx");
  const composer = read("src/components/ChatInput.tsx");
  assert.doesNotMatch(study, /upload PDFs?/i);
  assert.match(study, /Paste text or upload images of your notes/i);
  assert.match(composer, /f\.type\.startsWith\("image\/"\)/);
  assert.match(composer, /f\.type\.startsWith\("text\/"\)/);
});

test("model selectors only advertise backed intelligence modes", () => {
  const desktop = read("src/components/ModelSelector.tsx");
  const responsive = read("src/components/ResponsiveModelSelector.tsx");
  const chat = read("src/routes/api/chat.ts");
  const shell = read("src/routes/index.tsx");
  assert.match(desktop, /ResponsiveModelSelector/);
  assert.match(responsive, /versionGroupsForTier\(userTier\)/);
  for (const selector of [desktop, responsive])
    assert.doesNotMatch(selector, /KOVA_VERSIONS|kova-version|KovaGPT version|Kova 3\.[345]/);
  assert.doesNotMatch(shell, /kovaVersion|kova-version/);
  assert.doesNotMatch(
    chat,
    /kovaVersion|KOVA_VERSION|IS_LEGACY_KOVA|previous-generation model|Math\.random\(\) \* 4000/,
  );
  assert.match(chat, /if \(m\.reasoning\)/);
  assert.equal(existsSync("src/lib/kova-version.ts"), false);
});

test("upload quotas follow the signed-in tier and reject invalid sizes before charging", () => {
  const composer = read("src/components/ChatInput.tsx");
  const limits = read("src/lib/limits.ts");
  const modes = read("src/lib/modes.ts");
  assert.match(composer, /const uploadLimit = DAILY_UPLOAD_LIMIT_BY_TIER\[userTier\]/);
  assert.equal((composer.match(/tryUseUpload\(uploadLimit\)/g) ?? []).length, 2);
  assert.doesNotMatch(composer, /getUsage\(\)|u\.uploads >= DAILY_UPLOAD_LIMIT/);
  assert.match(limits, /tryUseUpload\(limit = DAILY_UPLOAD_LIMIT\)/);
  assert.match(limits, /u\.uploads >= normalizedLimit/);
  assert.match(modes, /free: 3,\s*plus: 50,\s*pro: 200,/);
  const imageSize = composer.indexOf("f.size > MAX_IMAGE_FILE_BYTES");
  const imageCharge = composer.indexOf("tryUseUpload(uploadLimit)");
  const textSize = composer.indexOf(
    "f.size > (isDocument ? 10 * 1024 * 1024 : MAX_TEXT_FILE_BYTES)",
  );
  const textCharge = composer.indexOf("tryUseUpload(uploadLimit)", imageCharge + 1);
  assert.ok(imageSize > -1 && imageSize < imageCharge);
  assert.ok(textSize > -1 && textSize < textCharge);
});

test("scheduled task surfaces stay truthful while the runner is disabled", () => {
  const server = read("src/lib/scheduled-tasks.functions.ts");
  const route = read("src/routes/scheduled-tasks.tsx");
  const sidebar = read("src/components/Sidebar.tsx");
  const palette = read("src/components/CommandPalette.tsx");
  const capabilities = read("src/platform/capabilities.ts");
  const capabilityRegistry = read("src/lib/capability-registry.ts");
  const help = read("src/routes/help.tsx");
  const study = read("src/routes/study-assistant.tsx");
  const product = read("src/lib/product-completeness.server.ts");
  const notifications = read("src/routes/notifications.tsx");
  const parity = read("docs/chatgpt-feature-parity.md");
  assert.match(server, /activeScheduledExecutionReadiness\(\)/);
  assert.match(
    read("src/lib/scheduled-execution-readiness.server.ts"),
    /scheduled_task_runtime_ready/,
  );
  assert.match(route, /Scheduled Tasks Status/);
  assert.match(route, /Upgrading will not enable scheduled/);
  assert.doesNotMatch(route, /Schedule KovaGPT to do something for you later/);
  assert.match(sidebar, /Scheduled tasks status/);
  assert.match(palette, /Scheduled Tasks status/);
  assert.match(capabilities, /label: "Scheduled Tasks status"/);
  assert.match(
    capabilityRegistry,
    /Background scheduled execution is unavailable in this deployment/,
  );
  assert.match(capabilityRegistry, /Previously saved task records can still be managed/);
  assert.doesNotMatch(help, /image generation, scheduled tasks/);
  assert.doesNotMatch(study, /scheduled reminders/i);
  assert.match(product, /title: "Scheduled execution unavailable"/);
  assert.match(notifications, /historical task notifications/);
  assert.match(parity, /Scheduled Tasks\s+\| Intentionally unavailable/);
});

test("billing checkout and entitlements use exact supported plan keys", () => {
  const plans = read("src/lib/billing-plans.ts");
  const checkout = read("src/utils/payments.functions.ts");
  const apiAuth = read("src/lib/api-auth.server.ts");
  const clientTier = read("src/hooks/useTier.ts");
  const webhook = read("src/routes/api/public/payments/webhook.ts");
  assert.match(plans, /plus_monthly:[\s\S]*tier: "plus"[\s\S]*trialPeriodDays: 30/);
  assert.match(plans, /pro_monthly:[\s\S]*tier: "pro"[\s\S]*trialPeriodDays: 0/);
  assert.match(plans, /export const BILLING_ENV = "live" as const/);
  assert.match(plans, /Object\.prototype\.hasOwnProperty\.call\(BILLING_PLANS, value\)/);
  assert.ok(
    checkout.indexOf("resolveBillingPlan(data.priceId)") < checkout.indexOf("stripe.prices.list"),
  );
  assert.match(checkout, /lookup_keys: \[plan\.lookupKey\]/);
  assert.match(checkout, /trial_period_days: plan\.trialPeriodDays/);
  for (const source of [checkout, apiAuth, clientTier])
    assert.doesNotMatch(source, /\.includes\(["'](?:plus|pro)["']\)/);
  assert.match(apiAuth, /resolveEffectiveBillingTier\(caller\.supabaseAdmin, userId\)/);
  assert.match(apiAuth, /return getUserTier\(caller, caller\.userId\)/);
  assert.match(clientTier, /rpc\("current_subscription_summary"\)/);
  assert.doesNotMatch(apiAuth, /tierForLookupKey|\.from\("subscriptions"\)/);
  assert.doesNotMatch(clientTier, /tierForLookupKey|\.from\("subscriptions"\)/);
  assert.match(webhook, /from\("billing_plan_tiers"\)/);
  assert.match(webhook, /mapping\.stripe_price_id|stripe_price_id/);
});
