import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { adSenseCsp } from "../../src/lib/adsense-csp.mjs";

const nonce = "AAAAAAAAAAAAAAAAAAAAAA==";
let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ResponseAdvertisement}from'./src/components/ResponseAdvertisement';createRoot(document.getElementById('root')).render(<main><p id="answer">29 × 31 = 899</p><ResponseAdvertisement/></main>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    plugins: [
      {
        name: "ad-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^@\/hooks\/useTier$/ }, () => ({
            path: "tier",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /adsense\.functions$/ }, () => ({
            path: "configuration",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            loader: "js",
            contents:
              path === "tier"
                ? `export const useTier=()=>({tier:window.fixtureTier||'free',status:window.fixtureStatus||'ready'});`
                : `export const getAdSenseConfiguration=async()=>({enabled:window.fixtureEnabled!==false});`,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});

const cmp = `
window.adPushes=0;
window.adsbygoogle.push=()=>{window.adPushes++};
let listener;
window.setAdConsent=(granted,eventStatus='useractioncomplete',gdprApplies=true)=>listener?.({listenerId:1,cmpStatus:'loaded',eventStatus,gdprApplies,purpose:{consents:{1:granted}},vendor:{consents:{755:granted}}},true);
window.__tcfapi=(command,version,callback)=>{
 if(command==='addEventListener'){listener=callback;window.setAdConsent(false,'tcloaded')}
 if(command==='removeEventListener'){listener=undefined}
};
window.googlefc.showRevocationMessage=()=>window.setAdConsent(false,'cmpuishown');
const waiting=window.googlefc.callbackQueue;
window.googlefc.callbackQueue={push:entry=>Object.values(entry).forEach(fn=>fn())};
waiting.forEach(entry=>window.googlefc.callbackQueue.push(entry));
`;

async function install(
  page: import("@playwright/test").Page,
  options: {
    tier?: string;
    status?: string;
    enabled?: boolean;
    gpc?: boolean;
    broken?: boolean;
    blocked?: boolean;
  } = {},
) {
  let loads = 0;
  await page.addInitScript((options) => {
    Object.assign(window, {
      fixtureTier: options.tier,
      fixtureStatus: options.status,
      fixtureEnabled: options.enabled,
    });
    if (options.gpc) Object.defineProperty(navigator, "globalPrivacyControl", { value: true });
  }, options);
  await page.route("https://pagead2.googlesyndication.com/**", async (route) => {
    loads++;
    if (options.blocked) return route.abort("blockedbyclient");
    await route.fulfill({
      contentType: "application/javascript",
      body: options.broken
        ? `window.googlefc.callbackQueue.push=()=>{throw Error('CMP unavailable')};window.googlefc.callbackQueue.forEach(entry=>Object.values(entry).forEach(fn=>{window.__tcfapi=()=>{throw Error('CMP unavailable')};fn()}));`
        : cmp,
    });
  });
  await page.route("https://kova-ad.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "content-security-policy": adSenseCsp(
          "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; connect-src 'self'; frame-src 'self'",
          nonce,
        ),
      },
      body: `<html><head><meta property="csp-nonce" content="${nonce}"></head><body><div id="root"></div><script nonce="${nonce}">${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    }),
  );
  await page.goto("https://kova-ad.test/");
  await expect(page.locator("#answer")).toHaveText("29 × 31 = 899");
  return () => loads;
}

test("CMP loads before an ad request; grant, withdrawal and renewed consent preserve the answer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const loads = await install(page);
  await expect(page.getByRole("button", { name: "Privacy and cookie settings" })).toBeVisible();
  expect(loads()).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, "adPushes"))).toBe(0);
  await page.evaluate(() => Reflect.get(window, "setAdConsent")(true));
  await expect(page.locator("ins.adsbygoogle")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "adPushes"))).toBe(1);
  await page.getByRole("button", { name: "Privacy and cookie settings" }).click();
  await expect(page.locator("ins.adsbygoogle")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, "setAdConsent")(true));
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "adPushes"))).toBe(2);
  expect(loads()).toBe(1);
  await expect(page.locator("#answer")).toHaveText("29 × 31 = 899");
  expect(errors).toEqual([]);
});

test("explicit non-GDPR delivery remains contextual and fits phone, tablet and desktop widths", async ({
  page,
}) => {
  await install(page);
  await expect(page.getByRole("button", { name: "Privacy and cookie settings" })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "setAdConsent")(false, "tcloaded", false));
  const unit = page.locator("ins.adsbygoogle");
  await expect(unit).toBeVisible();
  await expect(unit).toHaveAttribute("data-restrict-data-processing", "1");
  await expect(unit).toHaveAttribute("data-tag-for-age-treatment", "2");
  expect(
    await page.evaluate(() => Reflect.get(window, "adsbygoogle").requestNonPersonalizedAds),
  ).toBe(1);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await page.locator("[data-response-ad]").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect(page.locator("#answer")).toHaveText("29 × 31 = 899");
  }
});

for (const options of [
  { tier: "plus" },
  { tier: "pro" },
  { status: "loading" },
  { enabled: false },
  { gpc: true },
])
  test(`no advertising code for ${JSON.stringify(options)}`, async ({ page }) => {
    const loads = await install(page, options);
    await expect(page.locator("[data-response-ad]")).toHaveCount(0);
    expect(loads()).toBe(0);
  });

for (const options of [{ blocked: true }, { broken: true }])
  test(`vendor failure leaves the response usable: ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await install(page, options);
    await expect(page.locator("[data-response-ad]")).toHaveCount(0);
    await expect(page.locator("#answer")).toHaveText("29 × 31 = 899");
    expect(errors).toEqual([]);
  });
