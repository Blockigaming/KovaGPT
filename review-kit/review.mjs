import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer, ready } from "./serve.mjs";
import { recoveryCrudFixture } from "./review/crud-fixture.mjs";
import { fixture } from "./review/base-fixture.mjs";
import {
  installImageReview,
  IMAGE_REVIEW_SCENARIOS,
  IMAGE_REVIEW_DISCLOSURE,
} from "./image-review-fixture.mjs";
import { installReviewState, REVIEW_STATE_SCENARIOS } from "./review-state-fixtures.mjs";
const root = fileURLToPath(new URL("./", import.meta.url));
process.chdir(root);
const source = JSON.parse(readFileSync(join(root, "SOURCE.json"), "utf8"));
const args = new Map(
  process.argv.slice(2).map((x) => {
    const [k, ...v] = x.replace(/^--/, "").split("=");
    return [k, v.join("=") || true];
  }),
);
const executablePath = [
  args.get("chrome"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find((x) => typeof x === "string" && existsSync(x));
if (!executablePath)
  throw Error(
    "Chrome/Chromium required; use --chrome=/absolute/path. Nothing is installed automatically.",
  );
const paths = [
  "/",
  "/library",
  "/images",
  "/projects",
  "/projects/33333333-3333-4333-8333-333333333333",
  "/scheduled-tasks",
  "/apps",
  "/work",
  "/discovery",
  "/help",
  "/pricing",
  "/auth",
  "/reset-password",
  "/checkout/return",
  "/terms",
  "/privacy",
  "/refund",
  "/memory",
  "/notifications",
  "/trusted-contacts",
  "/files",
  "/write",
  "/share-inbox",
  "/kovas",
  "/admin/kovas",
  "/developers/connections",
  "/developers/console",
  "/developers/authorize",
  "/prompt-studio",
  "/context-packs",
  "/knowledge-graph",
  "/contact-support",
  "/getting-started",
  "/status",
];
const sizes = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
  small: { width: 320, height: 700 },
};
const server = startServer();
let browser, appContext;
try {
  await ready(server);
  const version = await fetch("http://127.0.0.1:4189/api/version").then((r) => r.json());
  if (version.sha !== source.buildCommit)
    throw Error("Unexpected local build identity. Stop the other server before review.");
  browser = await chromium.launch({ executablePath, headless: !!args.get("smoke") });
  const controller = await browser.newContext({
    viewport: { width: 860, height: 700 },
    serviceWorkers: "block",
  });
  const controls = await controller.newPage();
  let opening = false;
  async function openReview(o) {
    if (opening) return;
    opening = true;
    try {
      if (
        !paths.includes(o.path) ||
        !["guest", "free", "plus", "pro"].includes(o.account) ||
        !["dark", "light", "system"].includes(o.theme) ||
        !(o.size in sizes) ||
        !["populated", "empty", "error"].includes(o.state)
      )
        throw Error("Invalid review option");
      if (appContext) await appContext.close();
      appContext = await browser.newContext({
        viewport: sizes[o.size],
        isMobile: ["phone", "small"].includes(o.size),
        hasTouch: o.size !== "desktop",
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      const page = await appContext.newPage();
      const theme = o.theme === "system" ? "dark" : o.theme;
      if (o.account === "guest") await fixture(page, theme, false, false, "free");
      else await recoveryCrudFixture(page, theme, o.account);
      if (o.state === "empty")
        await page.route("**/api/library/items", (r) =>
          r.fulfill({ json: { items: [], cursor: null, hasMore: false } }),
        );
      if (o.state === "error")
        await page.route("**/api/library/**", (r) =>
          r.fulfill({
            status: 503,
            json: { error: "Simulated read failure. Change state or reset to retry." },
          }),
        );
      if (o.theme === "system")
        await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "system"));
      const imageScenario = IMAGE_REVIEW_SCENARIOS.includes(o.scenario);
      if (imageScenario && o.account === "guest")
        throw Error("Image sample review requires a synthetic signed-in account");
      const scenario = imageScenario
        ? { path: "/images" }
        : await installReviewState(page, o.scenario ?? "default", o.account);
      if (imageScenario) await installImageReview(page, o.scenario);
      await page.goto("http://127.0.0.1:4189" + (scenario.path ?? o.path));
      if (imageScenario)
        await page.evaluate((disclosure) => {
          const banner = document.createElement("aside");
          banner.setAttribute("aria-label", "Private review disclosure");
          banner.style.cssText =
            "position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;padding:12px;border-radius:16px;background:#171717;color:white;border:1px solid #777;font:13px system-ui;max-width:720px";
          banner.textContent = disclosure;
          const close = document.createElement("button");
          close.textContent = "Hide review notice";
          close.style.cssText =
            "display:block;min-height:44px;margin-top:4px;text-decoration:underline";
          close.onclick = () => banner.remove();
          banner.append(close);
          document.body.append(banner);
        }, IMAGE_REVIEW_DISCLOSURE);
      await page.bringToFront();
      return "Opened " + o.path + " with a fresh synthetic " + o.account + " context.";
    } finally {
      opening = false;
    }
  }
  await controls.exposeFunction("openPluginReview", async (core = false, size = "desktop") => {
    const context = await browser.newContext({
      viewport: sizes[size] ?? sizes.desktop,
      isMobile: ["phone", "small"].includes(size),
      hasTouch: size !== "desktop",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const files = {
        "/__plugin-review": [core ? "core-preview.html" : "plugin-preview.html", "text/html"],
        "/review/core-preview.js": ["core-preview.js", "text/javascript"],
        "/review/plugin-preview.js": ["plugin-preview.js", "text/javascript"],
        "/review/plugin-preview.css": ["plugin-preview.css", "text/css"],
      };
      const file = url.origin === "http://127.0.0.1:4189" && files[url.pathname];
      return file
        ? route.fulfill({ contentType: file[1], body: readFileSync(join(root, "review", file[0])) })
        : route.abort();
    });
    await page.goto("http://127.0.0.1:4189/__plugin-review");
    await page.bringToFront();
  });
  await controls.exposeFunction("openReview", openReview);
  await controls.route("**/*", (r) =>
    r.request().url() === "http://127.0.0.1:4189/__local-review"
      ? r.fulfill({
          contentType: "text/html",
          body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kova private review controls</title><style>body{font:16px system-ui;margin:36px;background:#101010;color:#eee;max-width:720px}label{display:block;margin:18px 0}select,button{font:inherit;padding:12px;border-radius:14px;background:#222;color:white;border:1px solid #555;max-width:100%}select{margin:8px;min-width:180px}button{cursor:pointer}p{line-height:1.6;color:#bbb}</style><h1>Kova private interface review</h1><p>Source ${source.commit}. Synthetic accounts and local fixtures only. Each Open or Reset starts a separate clean account context. Close this controls tab while inspecting the app if preferred; no review controls enter production code. Sample image scenarios add a hideable disclosure notice.</p><form id="review"><label>Page<select name="path">${paths.map((p) => "<option>" + p + "</option>").join("")}</select></label><label>Account<select name="account"><option>free</option><option>guest</option><option>plus</option><option>pro</option></select></label><label>Theme<select name="theme"><option>dark</option><option>light</option><option>system</option></select></label><label>Viewport<select name="size"><option>desktop</option><option>tablet</option><option>phone</option><option>small</option></select></label><label>Library state<select name="state"><option>populated</option><option>empty</option><option>error</option></select></label><label>State scenario<select name="scenario">${[...REVIEW_STATE_SCENARIOS, ...IMAGE_REVIEW_SCENARIOS].map((state) => "<option>" + state + "</option>").join("")}</select></label><p>Trial scenarios require Plus. Other billing lifecycle scenarios require Plus or Pro. Billing states open Home: choose Settings → Subscriptions. Onboarding and recovery scenarios choose their relevant page automatically.</p><button>Open / reset fixtures</button></form><p><button type="button" onclick="window.openPluginReview(false, document.querySelector('[name=size]').value)">Review all 13 plugin connection flows</button> <button type="button" onclick="window.openPluginReview(true, document.querySelector('[name=size]').value)">Review support, sharing, sessions and billing drafts</button></p><p role="status" id="status"></p><p>Use product navigation to open Settings and nested dialogs. Project create, rename and delete, and Library item deletion use disposable in-memory review data. Reset discards these changes. Live billing, provider writes, scheduled execution and generation are disconnected. Viewport emulation does not certify physical-device keyboards or cameras.</p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');const output=document.getElementById('status');b.disabled=true;try{output.textContent=await window.openReview(Object.fromEntries(new FormData(e.target)))}catch(e){output.textContent=e.message}finally{b.disabled=false}}</script>`,
        })
      : r.abort(),
  );
  await controls.goto("http://127.0.0.1:4189/__local-review");
  await openReview({
    path: "/",
    account: "free",
    theme: "dark",
    size: args.get("phone") ? "phone" : "desktop",
    state: "populated",
  });
  console.log("PRIVATE_REVIEW_READY source=" + source.commit + " build=" + source.buildCommit);
  if (args.get("smoke")) {
    await appContext.pages()[0].getByRole("textbox", { name: "Message KovaGPT" }).waitFor();
    await browser.close();
    console.log("REVIEW_SMOKE=PASS");
  } else await new Promise((r) => browser.once("disconnected", r));
} finally {
  if (browser?.isConnected()) await browser.close();
  server.stop();
}
