import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

function watchForHydrationErrors(page: import("@playwright/test").Page) {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|server rendered html|did not match/iu.test(message.text())
    ) {
      messages.push(message.text());
    }
  });
  return messages;
}

test("the public comparison page is indexable, stable, and KovaGPT-branded", async ({ page }) => {
  const hydrationErrors = watchForHydrationErrors(page);
  const response = await page.goto("/chatgpt-alternative", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  expect(response?.headers()["x-robots-tag"]).toBe("index, follow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index,\s*follow/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "KovaGPT, built for focused AI work",
  );
  await expect(page.getByText(/not affiliated with or endorsed by OpenAI/iu)).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("private workspace pages are not indexable or followable", async ({ page }) => {
  const response = await page.goto("/projects", { waitUntil: "domcontentloaded" });

  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
});

test("not-found responses remain noindex across SSR and hydration", async ({ page }) => {
  const hydrationErrors = watchForHydrationErrors(page);
  const response = await page.goto("/__kova_missing_page__", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  expect(response?.status()).toBe(404);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex,\s*nofollow/u,
  );
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  await expect(page.getByText(/Reference kova-/u)).toHaveCount(0);
  expect(hydrationErrors).toEqual([]);
});

test("the sitemap advertises only successful public pages", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280x800");
  test.setTimeout(90_000);

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  expect(sitemapResponse.headers()["content-type"]).toContain("application/xml");
  expect(sitemapResponse.headers()["x-robots-tag"]).toBe("noindex, follow");

  const sitemap = await sitemapResponse.text();
  const paths = [...sitemap.matchAll(/<loc>https:\/\/kovagpt\.com([^<]*)<\/loc>/gu)].map(
    (match) => match[1] || "/",
  );
  expect(paths.length).toBeGreaterThan(10);
  expect(new Set(paths).size).toBe(paths.length);

  for (let offset = 0; offset < paths.length; offset += 4) {
    const batch = paths.slice(offset, offset + 4);
    const responses = await Promise.all(batch.map((path) => request.get(path)));
    for (let index = 0; index < batch.length; index += 1) {
      expect(responses[index].status(), batch[index]).toBeLessThan(400);
      expect(responses[index].headers()["x-robots-tag"], batch[index]).toBe("index, follow");
    }
  }
});
