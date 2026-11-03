import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  PUBLIC_WEBSITE_PAGES,
  PUBLIC_WEBSITE_FOOTER,
} from "../../src/lib/public-website-catalog.mjs";

const evidence = "artifacts/public-website";
const inventory = JSON.parse(
  await readFile("docs/public-website/route-inventory.json", "utf8"),
) as { paths: string[] };
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
});

test("implemented homepage, pricing tabs, FAQ, original asset, and responsive evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
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
    "/images/classroom-original.png",
  );
  await expect(page.locator(".public-classroom img")).toHaveJSProperty("naturalWidth", 164);
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
  const summary = page.getByText("What is KovaGPT and how does it work?", { exact: true });
  await summary.focus();
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
      await page.goto("/");
      await page.screenshot({ path: `${evidence}/mobile-home.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test("every information route and footer destination resolves with meaningful content", async ({
  page,
  request,
}) => {
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
}) => {
  await page.goto("/login?return_to=%2Fpricing%3Fplan%3Dplus_monthly");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("public-preview@example.invalid");
  await page.screenshot({ path: `${evidence}/authentication.png` });
  await page.getByRole("button", { name: "Continue with email", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\?email=public-preview%40example\.invalid/);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});
