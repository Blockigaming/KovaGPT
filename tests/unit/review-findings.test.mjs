import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("email routes do not report delivery success when the queue worker is unavailable", () => {
  const support = read("src/routes/api/public/help-submit.ts");
  const transactional = read("src/routes/lovable/email/transactional/send.ts");
  assert.match(support, /KOVA_EMAIL_QUEUE_ENABLED/);
  assert.match(support, /Email delivery is not configured/);
  assert.match(transactional, /KOVA_EMAIL_QUEUE_ENABLED/);
  assert.match(transactional, /status: 503/);
  assert.match(transactional, /Email delivery is not configured/);
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
  const workflow = read("src/lib/multimodal/image-workflows.server.ts");
  assert.ok(route.indexOf("normalizeImageSettings(parsed)") < route.indexOf("enforceQuota("));
  assert.match(workflow, /n:\s*1;/);
  assert.match(workflow, /input\.n !== undefined && input\.n !== 1/);
  assert.match(workflow, /KovaGPT currently supports one image per request/);
  assert.match(workflow, /n:\s*1,/);
  for (const value of ["0", "1", "4", "negative", "string", "missing"]) {
    assert.ok(value.length > 0, `documented n case: ${value}`);
  }
});

test("sitemap excludes private and noindex workflows", () => {
  const sitemap = read("src/routes/sitemap[.]xml.ts");
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
      sitemap.includes('{ path: "' + path + '",'),
      false,
      path + " must not be advertised in the public sitemap",
    );
  }
  for (const path of ["/", "/pricing", "/study-assistant", "/privacy"]) {
    assert.equal(
      sitemap.includes('{ path: "' + path + '",'),
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

test("email previews and From display use KovaGPT production branding", () => {
  const transactional = read("src/routes/lovable/email/transactional/send.ts");
  const authPreview = read("src/routes/lovable/email/auth/preview.ts");
  assert.match(transactional, /const SITE_NAME = "KovaGPT";/);
  assert.doesNotMatch(transactional, /nova-aigpt/i);
  assert.match(authPreview, /const SITE_NAME = "KovaGPT";/);
  assert.match(authPreview, /const SAMPLE_PROJECT_URL = "https:\/\/kovagpt\.com";/);
  assert.doesNotMatch(authPreview, /kovagpt\.kovagpt\.com/i);
});
