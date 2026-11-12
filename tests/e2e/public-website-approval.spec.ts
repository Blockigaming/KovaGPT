import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import {
  PUBLIC_WEBSITE_PAGES,
  PUBLIC_WEBSITE_FOOTER,
} from "../../src/lib/public-website-catalog.mjs";

function evidenceDirectory(projectName: string) {
  const root = "artifacts/public-website";
  return projectName ? `${root}/${projectName}` : root;
}
const inventory = JSON.parse(
  await readFile("docs/public-website/route-inventory.json", "utf8"),
) as { paths: string[] };
test.beforeEach(async () => {
  await mkdir(evidenceDirectory(test.info().project.name), { recursive: true });
});

test("implemented homepage, pricing tabs, FAQ, restored responsive asset, and responsive evidence", async ({
  page,
  context,
}, testInfo) => {
  const evidence = evidenceDirectory(testInfo.project.name);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  if (process.env.KOVA_BUILD_SHA)
    await expect(page.locator('meta[name="kova-build"]')).toHaveAttribute(
      "content",
      process.env.KOVA_BUILD_SHA,
    );
  await expect(
    page.getByRole("heading", { name: "Question what’s next", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with GitHub", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".public-classroom img")).toHaveAttribute(
    "src",
    "/images/classroom-hero-restored.webp",
  );
  await expect
    .poll(() =>
      page
        .locator(".public-classroom img")
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: `${evidence}/desktop-hero.png` });
  await page.screenshot({ path: `${evidence}/desktop-full.png`, fullPage: true });
  await page.locator(".public-plans").screenshot({ path: `${evidence}/pricing-individual.png` });
  await page.getByRole("button", { name: "Team and Enterprise", exact: true }).click();
  await expect(page.locator(".public-business-plans")).toBeVisible();
  await expect(page.locator(".public-plan-badge")).toHaveText(["Coming soon", "Coming soon"]);
  await page
    .locator(".public-plans")
    .screenshot({ path: `${evidence}/pricing-team-enterprise.png` });
  await page.getByRole("button", { name: "Individual", exact: true }).click();
  const summary = page
    .locator(".public-website-faq summary")
    .filter({ hasText: "What is KovaGPT and how does it work?" });
  await summary.focus({ timeout: 10000 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".public-website-faq details").first()).toHaveAttribute("open", "");
  await page.locator(".public-website-faq").screenshot({ path: `${evidence}/faq.png` });
  await page.locator("footer").screenshot({ path: `${evidence}/footer.png` });
  for (const [width, height] of [
    [320, 700],
    [375, 812],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1024, 768],
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `horizontal overflow at ${width}`).toBe(false);
    if (width === 390) {
      // A fresh page avoids inheriting the FAQ focus and scroll position
      // from the desktop screenshots.
      const mobilePage = await context.newPage();
      try {
        await mobilePage.setViewportSize({ width, height });
        mobilePage.on("pageerror", (error) => errors.push(error.message));
        await mobilePage.goto("/");
        await expect(mobilePage.locator("html")).toHaveAttribute("data-kova-hydration", "ready");
        await mobilePage.evaluate(() => document.fonts.ready);
        await expect.poll(() => mobilePage.evaluate(() => window.scrollY)).toBe(0);
        await mobilePage.screenshot({ path: `${evidence}/mobile-hero.png` });
        await mobilePage.screenshot({ path: `${evidence}/mobile-home.png`, fullPage: true });
      } finally {
        await mobilePage.close();
      }
    }
  }
  expect(errors).toEqual([]);
});

test("every information route and footer destination resolves with meaningful content", async ({
  page,
  request,
}, testInfo) => {
  const evidence = evidenceDirectory(testInfo.project.name);
  const results: { path: string; status: number; title?: string }[] = [];
  const extras = [
    "/",
    "/login",
    "/signup",
    "/pricing",
    "/about",
    "/help",
    "/changelog",
    "/status",
    "/developers",
    "/terms",
    "/privacy",
    "/refund",
    "/transparency",
    "/accessibility",
  ];
  const paths = new Set([
    ...inventory.paths,
    ...PUBLIC_WEBSITE_PAGES.map((item) => item.path),
    ...PUBLIC_WEBSITE_FOOTER.flatMap((group) => group.links.map((link) => link.to)),
    ...extras,
  ]);
  for (const path of paths) {
    const response = await request.get(path);
    const body = await response.text();
    results.push({ path, status: response.status() });
    expect(response.ok(), path).toBe(true);
    expect(body, path).not.toContain("This page isn’t available");
    expect(body, path).toContain("main-content");
  }
  await writeFile(`${evidence}/route-results.json`, JSON.stringify(results, null, 2));
  for (const [name, path, heading] of [
    ["product", "/features/projects", "Projects"],
    ["developer", "/developers/responses", "Responses API"],
    ["help", "/help/files", "File help"],
    ["legal", "/legal/billing", "Billing terms"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${name}-page.png`, fullPage: true });
  }
});

test("email entry uses the existing auth route and does not submit a real account", async ({
  page,
}, testInfo) => {
  const evidence = evidenceDirectory(testInfo.project.name);
  await page.goto("/login?return_to=%2Fpricing%3Fplan%3Dplus_monthly");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("public-preview@example.invalid");
  await page.screenshot({ path: `${evidence}/authentication.png` });
  await page.getByRole("button", { name: "Continue with email", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\?email=public-preview%40example\.invalid/);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("hosted checkout starts automatically and fails safely without configured payments", async ({
  page,
}, testInfo) => {
  const evidence = evidenceDirectory(testInfo.project.name);
  // This workflow deliberately builds without payment credentials. The fixture
  // owns authentication only; this is not real Stripe acceptance evidence.
  await installAuthenticatedFixture(page);
  const stripeRequests: string[] = [];
  page.on("request", (request) => {
    if (/(?:^|\.)stripe\.(?:com|network)$/u.test(new URL(request.url()).hostname))
      stripeRequests.push(request.method());
  });
  await page.goto("/pricing");
  await waitForKovaHydration(page);
  const start = page.getByRole("button", { name: "Start Plus", exact: true });
  await start.click();
  await expect(page).toHaveURL(/\/subscribe\?plan=plus_monthly/);
  const dialog = page.getByRole("main");
  // The credential-free fixture must never invent a usable payment session.
  await expect(dialog.locator('[data-checkout-state="error"]')).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Secure checkout could not open.");
  await expect(dialog.getByRole("button", { name: "Retry checkout", exact: true })).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/checkout-unavailable.png` });
  await page.getByRole("link", { name: "Back to plans", exact: true }).click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(page.getByRole("button", { name: "Start Plus", exact: true })).toBeVisible();
  expect(stripeRequests).toEqual([]);
});

// These are raw browser captures used to review and update the intentional
// signed-out design change. The normal visual suite still compares committed baselines.
test("collect exact guest visual baselines for review", async ({ browser }, testInfo) => {
  const evidence = evidenceDirectory(testInfo.project.name);
  for (const [project, width, height] of [
    ["phone-390x844", 390, 844],
    ["desktop-1440x900", 1440, 900],
  ] as const) {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:4189",
        viewport: { width, height },
        isMobile: project.startsWith("phone"),
        hasTouch: project.startsWith("phone"),
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.addInitScript((value) => localStorage.setItem("kova-theme-mode", value), theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Question what’s next");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".public-classroom img")).toHaveJSProperty("complete", true);
      await page.screenshot({
        path: `${evidence}/account-entry-${theme}-${project}-linux.png`,
        animations: "disabled",
        caret: "hide",
        scale: "css",
      });
      await context.close();
    }
  }
});
