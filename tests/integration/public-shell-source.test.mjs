import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const directMainRoutes = [
  "src/routes/ai-safety.tsx",
  "src/routes/blog.ai-market-research-guide.tsx",
  "src/routes/blog.best-ai-assistants.tsx",
  "src/routes/blog.best-ai-market-research-tools.tsx",
  "src/routes/changelog.tsx",
  "src/routes/connect.tsx",
  "src/routes/getting-started.tsx",
  "src/routes/help.tsx",
  "src/routes/modes.tsx",
  "src/routes/pricing.tsx",
  "src/routes/refund.tsx",
  "src/routes/status.tsx",
  "src/routes/terms.tsx",
];

test("public navigation exposes mobile and current-page semantics", async () => {
  const [shell, footer, logo] = await Promise.all([
    read("src/components/public/PublicShell.tsx"),
    read("src/components/PublicFooter.tsx"),
    read("src/components/NovaLogo.tsx"),
  ]);

  assert.match(shell, /aria-controls="public-mobile-navigation"/);
  assert.match(shell, /aria-expanded=\{open\}/);
  assert.match(shell, /event\.key !== "Escape"/);
  assert.match(shell, /menuButtonRef\.current\?\.focus\(\)/);
  assert.match(shell, /aria-current=\{currentPage \? "page" : undefined\}/);
  assert.match(shell, /const currentPage = pathname === to/);
  assert.match(shell, /const currentSection = isCurrentPath\(pathname, to\)/);
  assert.match(shell, /sm:pl-\[max\(1\.5rem,env\(safe-area-inset-left\)\)\]/);
  assert.match(shell, /Open KovaGPT/);
  assert.match(shell, /safe-area-inset-top/);
  assert.match(shell, /min-h-11/);
  assert.match(footer, /aria-current=\{currentPage \? "page" : undefined\}/);
  assert.match(footer, /min-h-11/);
  assert.match(footer, /independently developed/i);
  assert.match(footer, /features can depend\s+on plan\s+eligibility and external providers/i);
  assert.match(logo, /decorative = false/);
  assert.match(logo, /alt = "KovaGPT"/);
  assert.match(logo, /aria-hidden=\{decorative \|\| undefined\}/);
  assert.match(logo, /aria-label=\{decorative \? undefined : alt\}/);
  assert.match(logo, /role=\{decorative \? undefined : "img"\}/);
  assert.match(logo, /data-logo-variant=\{mark \? "mark" : "standard"\}/);
  assert.doesNotMatch(logo, /<img|kova-logo\.png/);
});

test("public layouts provide a single skip-link destination", async () => {
  const [site, seoLanding, legalArticle, ...routes] = await Promise.all([
    read("src/components/public/PublicSite.tsx"),
    read("src/components/SeoLanding.tsx"),
    read("src/components/LegalArticle.tsx"),
    ...directMainRoutes.map(read),
  ]);

  for (const source of [site, seoLanding, legalArticle]) {
    assert.match(source, /<main id="main-content" tabIndex=\{-1\}/);
  }

  for (const [index, source] of routes.entries()) {
    assert.match(source, /<PublicShell>/, `${directMainRoutes[index]} should use PublicShell`);
    assert.match(
      source,
      /id="main-content"/,
      `${directMainRoutes[index]} should expose the skip-link target`,
    );
    assert.equal(
      source.match(/id="main-content"/g)?.length,
      1,
      `${directMainRoutes[index]} should define one skip-link target`,
    );
  }

  for (const path of ["src/routes/privacy.tsx", "src/routes/contact-support.tsx"]) {
    const source = await read(path);
    assert.match(source, /<PublicShell>/);
    assert.match(source, /<LegalArticle>/);
  }
});

test("route metadata remains authoritative after hydration", async () => {
  const [root, notifications] = await Promise.all([
    read("src/routes/__root.tsx"),
    read("src/routes/notifications.tsx"),
  ]);

  assert.doesNotMatch(root, /PageTitleManager/);
  assert.doesNotMatch(root, /PAGE_TITLES/);
  assert.doesNotMatch(root, /document\.title\s*=/);
  assert.match(root, /<HeadContent \/>/);
  assert.match(notifications, /head:\s*\(\) =>/);
  assert.match(notifications, /title: "KovaGPT Notifications"/);
});
