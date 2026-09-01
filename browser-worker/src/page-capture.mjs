import { chromium } from "@playwright/test";
import { assertRequestRemainsSafe, resolvePinnedPublicUrl } from "./network-safety.mjs";

function stripHtml(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function safeTitle(value) {
  return String(value ?? "Untitled source").replace(/\s+/gu, " ").trim().slice(0, 300);
}

export async function captureAllowedPage({
  sourceUrl,
  allowedDomains,
  navigationTimeoutMs = 20_000,
  browserType = chromium,
  resolver,
}) {
  const target = await resolvePinnedPublicUrl(sourceUrl, allowedDomains, resolver);
  const timeout = Number(navigationTimeoutMs);
  if (!Number.isInteger(timeout) || timeout < 5_000 || timeout > 60_000) {
    throw new Error("browser_navigation_timeout_invalid");
  }

  const hostRule = `MAP ${target.hostname} ${target.pinnedAddress}, EXCLUDE localhost`;
  const browser = await browserType.launch({
    headless: true,
    args: [
      `--host-resolver-rules=${hostRule}`,
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-sandbox",
    ],
  });

  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      bypassCSP: false,
      javaScriptEnabled: false,
      serviceWorkers: "block",
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(timeout);
    page.setDefaultTimeout(timeout);

    page.on("dialog", (dialog) => void dialog.dismiss());
    page.on("download", (download) => void download.cancel());

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (!request.isNavigationRequest() || !["GET", "HEAD"].includes(request.method())) {
        await route.abort("blockedbyclient");
        return;
      }
      try {
        await assertRequestRemainsSafe(url, target, resolver);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });

    const response = await page.goto(target.url.href, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    if (!response || response.status() >= 400) {
      throw new Error("browser_source_http_error");
    }
    const finalUrl = await assertRequestRemainsSafe(page.url(), target, resolver);
    const contentType = response.headers()["content-type"] ?? "";
    if (!/text\/html|text\/plain|application\/xhtml\+xml/iu.test(contentType)) {
      throw new Error("browser_source_content_type_unsupported");
    }

    let text = await page.locator("body").innerText().catch(() => "");
    if (text.trim().length < 200) {
      const body = await response.body();
      if (body.byteLength > 2_000_000) throw new Error("browser_source_body_too_large");
      text = stripHtml(body.toString("utf8"));
    }
    text = text.replace(/\s+/gu, " ").trim().slice(0, 60_000);
    if (text.length < 40) throw new Error("browser_source_text_empty");

    const screenshot = await page.screenshot({
      fullPage: false,
      type: "png",
      animations: "disabled",
    });

    return {
      url: finalUrl.href,
      hostname: target.hostname,
      title: safeTitle(await page.title()),
      text,
      screenshot,
      status: response.status(),
      contentType: contentType.slice(0, 200),
      pinnedAddressFamily: target.pinnedAddress.includes(":") ? 6 : 4,
    };
  } finally {
    await browser.close();
  }
}
