// Actual Node production UI, isolated synthetic data. No provider, billing or AI action is sent.
import { readFile, readdir, mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";

const output = resolve(process.env.KOVA_AUDIT_OUTPUT || "../core-ui-browser");
const port = Number(process.env.KOVA_AUDIT_PORT || 8080);
const origin = `http://127.0.0.1:${port}`;
const report = {
  generatedAt: new Date().toISOString(),
  build: "actual production Node bundle",
  data: "isolated synthetic network fixtures",
  engine: "Chromium",
  cases: [],
  failures: [],
  blockedExternal: [],
  unavailable: [],
  serverLog: "",
};
const fixtureModule = ts.transpileModule(
  await readFile("tests/e2e/authenticated-fixture.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { installAuthenticatedFixture } = await import(
  "data:text/javascript;base64," + Buffer.from(fixtureModule).toString("base64")
);
const functions = new Map();
for (const file of await readdir("dist/server/_ssr")) {
  if (!file.startsWith("vendor-tanstack") || !file.endsWith(".mjs")) continue;
  const source = await readFile(resolve("dist/server/_ssr", file), "utf8");
  for (const match of source.matchAll(
    /"([a-f0-9]{64})":\s*\{\s*functionName: "(\w+)_createServerFn_handler"/g,
  ))
    functions.set(match[1], match[2]);
}
if (!functions.size)
  throw new Error("Build the Node production candidate first; server function manifest missing.");
await mkdir(output, { recursive: true });
const server = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    "globalThis.fetch=async()=>new Response(JSON.stringify({error:'Audit isolation: server outbound blocked'}),{status:503,headers:{'content-type':'application/json'}});await import('./dist/server/index.mjs');",
  ],
  {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      KOVA_GENERATION_DISABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (data) => {
    report.serverLog = (report.serverLog + data.toString()).slice(-12000);
  });
const owner = "22222222-2222-4222-8222-222222222222";
const project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Product launch · fixture",
  description: "Sample project for reviewing the actual interface.",
  system_prompt: "Keep notes clear.",
  color: "blue",
  owner_id: owner,
  created_at: "2026-01-01T12:00:00Z",
  updated_at: "2026-01-02T12:00:00Z",
  pinned_at: null,
  archived_at: null,
  deletion_requested_at: null,
  member_count: 1,
  chat_count: 0,
  file_count: 0,
  role: "owner",
};
const library = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Welcome notes · fixture",
    item_type: "document",
    source: "manual",
    content_text: "Sample saved text for reviewing the actual Library component. Not account data.",
    file_url: null,
    file_name: "welcome-notes.txt",
    file_type: "text/plain",
    file_size: 76,
    created_at: "2026-01-02T12:00:00Z",
  },
];
const summary = (tier) => ({
  tier,
  effectiveTier: tier,
  inherited: false,
  activeSubscriptionCount: 0,
  billingConflict: false,
  status: null,
  priceId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialing: false,
  hasBillingAccount: false,
  billingPortalAvailable: false,
});
function fixtureFunction(name, account) {
  if (name === "getSubscriptionSummary") return summary(account === "guest" ? "free" : account);
  if (name === "getGitHubManagement")
    return {
      configured: false,
      accounts: [],
      installations: [],
      repositories: [],
      health: "credentials_not_configured",
    };
  if (name === "isScheduledTasksEligible")
    return {
      eligible: ["plus", "pro"].includes(account),
      executionAvailable: false,
      reason: "No task worker is connected in this isolated browser audit.",
    };
  if (name === "listScheduledTaskOffers") return { sent: [], received: [] };
  if (name === "listProjects") return account === "guest" ? [] : [project];
  if (name === "getProject") return project;
  if (name === "listMembers")
    return [
      {
        user_id: owner,
        role: "owner",
        profile: { full_name: "Shell Parity", email: "review@example.invalid" },
      },
    ];
  if (name === "getProjectNote")
    return { content: "Sample notes. Synthetic fixture only.", updated_at: "2026-01-02T12:00:00Z" };
  if (name === "listLibraryPage")
    return { items: account === "guest" ? [] : library, cursor: null };
  if (name === "listMyLibrary") return account === "guest" ? [] : library;
  if (name === "getOnboarding" || name === "getOnboardingStatus")
    return { completed: true, primary_use: "work", response_style: "balanced" };
  if (name === "listScheduledTaskContextOptions") return { projects: [], library: [], chats: [] };
  if (name === "listScheduledTaskResourceOptions") return { resources: [], nextCursor: null };
  if (/^(list|search|fetch)/.test(name)) return [];
  if (/^(get|read)/.test(name)) return null;
  throw new Error("No fixture for this operation");
}
async function isolate(page, account, theme) {
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) {
      report.blockedExternal.push({ account, origin: url.origin, path: url.pathname });
      return route.abort("blockedbyclient");
    }
    const path = url.pathname;
    if (path.startsWith("/_serverFn/")) {
      const name = functions.get(path.split("/").at(-1));
      try {
        return await route.fulfill({
          json: { result: fixtureFunction(name || "unknown", account), context: {} },
        });
      } catch {
        report.unavailable.push({ account, path, name, method: request.method() });
        return route.fulfill({
          status: 503,
          json: { error: "Unavailable in the isolated browser audit. No action was sent." },
        });
      }
    }
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/chat/history")
      return route.fulfill({ json: { conversations: [], cursor: null } });
    if (path === "/api/library/folders") return route.fulfill({ json: { folders: [] } });
    if (path === "/api/library/items")
      return route.fulfill({ json: { items: account === "guest" ? [] : library, cursor: null } });
    if (path === "/api/google/status")
      return route.fulfill({
        json: {
          connected: false,
          state: "disconnected",
          accounts: [],
          configured: false,
          selectionRevision: 0,
          selectedConnectionId: null,
        },
      });
    if (path === "/api/github/tool")
      return route.fulfill({
        json: { connected: false, configured: false, ok: true, access_mode: "none", actions: [] },
      });
    if (path.startsWith("/api/integrations/"))
      return route.fulfill({
        json: { connections: [], accounts: [], providers: [], configured: false },
      });
    if (path === "/api/billing/status")
      return route.fulfill({
        json: { ...summary(account === "guest" ? "free" : account), configured: false },
      });
    report.unavailable.push({ account, path, method: request.method() });
    return route.fulfill({
      status: 503,
      json: {
        error: "This service is unavailable in the isolated browser audit. No action was sent.",
      },
    });
  });
  if (account !== "guest") await installAuthenticatedFixture(page, { tier: account });
  else await page.addInitScript(() => localStorage.clear());
  await page.addInitScript(
    ({ theme, principal }) => {
      localStorage.setItem("kova-theme-mode", theme);
      localStorage.setItem(`nova-gpt-settings-v1:${principal}`, JSON.stringify({ mode: theme }));
      localStorage.setItem("kova-sidebar-open", "1");
    },
    { theme, principal: account === "guest" ? "guest" : owner },
  );
}
async function ready(page) {
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 20000,
  });
  await expect(page.locator("body")).not.toContainText("Application error");
}
async function capture(page, name, record) {
  if (record.theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
    viewport: innerWidth,
  }));
  expect(dimensions.document, name + ": document overflow").toBeLessThanOrEqual(1);
  expect(dimensions.body, name + ": body overflow").toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(output, name + ".png"), animations: "disabled" });
  record.pages.push({ name, path: new URL(page.url()).pathname, dimensions });
}
async function openSidebar(page) {
  if ((await page.locator(".kova-sidebar").getAttribute("data-state")) === "open") return;
  await page
    .getByRole("button", { name: /^(Open menu|Open sidebar|Expand sidebar)$/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator(".kova-sidebar")).toBeVisible();
}
async function closeSidebar(page) {
  if ((await page.locator(".kova-sidebar").getAttribute("data-state")) !== "open") return;
  await page
    .getByRole("button", { name: /^(Close sidebar|Collapse sidebar)$/ })
    .filter({ visible: true })
    .click();
  await expect(page.locator(".kova-sidebar")).toBeHidden();
}
async function switches(page, record) {
  const controls = page
    .locator(".kova-settings-dialog")
    .getByRole("switch")
    .filter({ visible: true });
  const check = async () => {
    for (const control of await controls.all()) {
      const bounds = await control.evaluate((element) => {
        const track = element.getBoundingClientRect(),
          thumb = element.querySelector("span").getBoundingClientRect();
        return {
          state: element.getAttribute("data-state"),
          width: track.width,
          height: track.height,
          left: thumb.left - track.left,
          right: track.right - thumb.right,
          top: thumb.top - track.top,
          bottom: track.bottom - thumb.bottom,
        };
      });
      (record.switchGeometry ??= []).push(bounds);
      expect(bounds.width).toBeGreaterThan(bounds.height);
      for (const edge of ["left", "right", "top", "bottom"])
        expect(bounds[edge], "thumb stays inside track: " + edge).toBeGreaterThanOrEqual(0);
    }
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await check();
  if (await controls.count()) {
    await controls.first().click();
    await check();
    await controls.first().click();
    await check();
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
}
let browser;
try {
  for (let index = 0; index < 100; index++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    if (server.exitCode !== null) throw new Error("Node preview exited: " + report.serverLog);
    if (index === 99) throw new Error("Node preview did not become ready: " + report.serverLog);
    await new Promise((done) => setTimeout(done, 100));
  }
  for (const config of [
    { account: "guest", width: 1440, theme: "dark" },
    { account: "free", width: 390, theme: "light" },
    { account: "plus", width: 1440, theme: "light" },
    { account: "pro", width: 390, theme: "dark" },
  ]) {
    browser = await chromium.launch({
      executablePath: process.env.KOVA_CHROMIUM_EXECUTABLE,
      args: ["--single-process", "--no-zygote", "--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: config.width, height: 900 },
      colorScheme: config.theme,
      isMobile: config.width < 768,
      hasTouch: config.width < 768,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const record = { ...config, pages: [], controls: [], pageErrors: [], consoleErrors: [] };
    report.cases.push(record);
    page.on("pageerror", (error) => record.pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") record.consoleErrors.push(message.text());
    });
    await isolate(page, config.account, config.theme);
    try {
      await page.goto(origin);
      await ready(page);
      const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
      await expect(input).toBeVisible();
      if (config.account !== "guest")
        await expect(page.locator(".kova-account-copy strong")).toHaveText(/Shell Parity/);
      await input.fill("One line");
      expect((await input.boundingBox()).height).toBeLessThan(40);
      await input.press("Shift+Enter");
      await input.pressSequentially("Two lines");
      await expect(input).toHaveValue("One line\nTwo lines");
      await input.fill("");
      const plus = page
        .getByRole("button", { name: "Add files, tools, or prompts", exact: true })
        .filter({ visible: true });
      const send = page
        .getByRole("button", { name: "Send message", exact: true })
        .filter({ visible: true });
      for (const control of [plus, send]) {
        const b = await control.boundingBox();
        expect(Math.abs(b.width - b.height)).toBeLessThanOrEqual(1);
      }
      await plus.click();
      const options = page.locator(".kova-composer-primary-actions:visible");
      await expect(options).toBeVisible();
      const labels = await options
        .locator("button")
        .evaluateAll((buttons) =>
          buttons.map(
            (button) =>
              button.getAttribute("aria-label") ||
              button.querySelector("span")?.childNodes[0]?.textContent?.trim(),
          ),
        );
      expect(labels).toEqual(
        config.width < 1024
          ? ["Photos", "Camera", "Files", "Library"]
          : ["Photos", "Files", "Library", "Drawings", "Create Image"],
      );
      await capture(page, `${config.account}-attachments-${config.theme}`, record);
      await page.keyboard.press("Escape");
      await expect(options).toBeHidden();
      await expect(plus).toBeFocused();
      record.controls.push(
        "one-line and multiline input",
        "circular plus/send",
        "exact attachment options",
        "attachment Escape and focus return",
      );
      await openSidebar(page);
      await expect(
        page.locator(".kova-sidebar").getByRole("link", { name: "Files", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.locator(".kova-sidebar").getByRole("link", { name: /^(Terms|Privacy)$/ }),
      ).toHaveCount(0);
      await capture(page, `${config.account}-sidebar-${config.theme}`, record);
      await closeSidebar(page);
      if (config.width < 1024) {
        await page.locator(".kova-chat-main").evaluate((element) => {
          const fire = (type, x, y) =>
            element.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                touches: [new Touch({ identifier: 1, target: element, clientX: x, clientY: y })],
              }),
            );
          fire("touchstart", 110, 300);
          fire("touchmove", 235, 304);
        });
        await expect(page.locator(".kova-sidebar")).toBeVisible();
        await page
          .getByRole("button", { name: "Close navigation menu", exact: true })
          .click({ position: { x: config.width - 8, y: 250 } });
        await expect(page.locator(".kova-sidebar")).toBeHidden();
        record.controls.push("right swipe shortcut", "scrim dismissal");
      }
      await openSidebar(page);
      await page.keyboard.press("Escape");
      await expect(page.locator(".kova-sidebar")).toBeHidden();
      await openSidebar(page);
      await page
        .locator(".kova-sidebar")
        .getByRole("link", { name: "Library", exact: true })
        .click();
      await expect(page).toHaveURL(origin + "/library");
      await page.goBack();
      await expect(page).toHaveURL(origin + "/");
      await page.goForward();
      await expect(page).toHaveURL(origin + "/library");
      record.controls.push(
        "sidebar open close Escape",
        "Library navigation",
        "browser back forward",
      );
      for (const path of [
        "/",
        "/library",
        "/images",
        "/projects",
        "/scheduled-tasks",
        "/apps",
        "/pricing",
        "/help",
      ]) {
        await page.goto(origin + path);
        await ready(page);
        if (path !== "/")
          await expect(page.locator("h1:visible, h2:visible").first()).toBeVisible();
        if (path === "/library" && config.account !== "guest")
          await expect(page.getByText("Welcome notes · fixture", { exact: true })).toBeVisible();
        if (path === "/projects" && config.account !== "guest")
          await expect(page.getByText(project.name, { exact: true })).toBeVisible();
        if (path === "/images") {
          const timer = page.getByRole("button", { name: /^Timers(?: \(loading\))?$/ });
          if (await timer.count()) {
            const t = await timer.boundingBox(),
              h = await page.getByRole("heading", { name: "Images", exact: true }).boundingBox();
            expect(t.y + t.height).toBeLessThanOrEqual(h.y);
          }
        }
        await capture(
          page,
          `${config.account}-${path === "/" ? "assistant" : path.slice(1)}-${config.theme}`,
          record,
        );
      }
      await page.reload();
      await ready(page);
      record.controls.push("direct routes", "refresh", "Timer stays above page controls");
      await page.goto(origin);
      await ready(page);
      await openSidebar(page);
      await page
        .locator(".kova-sidebar")
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      await expect(page.locator(".kova-settings-dialog")).toBeVisible();
      await switches(page, record);
      await capture(page, `${config.account}-settings-${config.theme}`, record);
      await page.keyboard.press("Escape");
      await expect(page.locator(".kova-settings-dialog")).toBeHidden();
      for (const path of ["/terms", "/privacy"]) {
        await page.goto(origin + path);
        await ready(page);
        await capture(page, `${config.account}-${path.slice(1)}-${config.theme}`, record);
      }
      if (config.account === "guest") {
        for (const path of ["/auth", "/reset-password"]) {
          await page.goto(origin + path);
          await ready(page);
          await capture(page, `guest-${path.slice(1)}-${config.theme}`, record);
        }
        for (const viewport of [
          { width: 320, height: 812 },
          { width: 768, height: 900 },
          { width: 844, height: 390 },
        ]) {
          await page.setViewportSize(viewport);
          await page.goto(origin);
          await ready(page);
          await capture(page, `guest-shell-${viewport.width}x${viewport.height}`, record);
          await openSidebar(page);
          await capture(page, `guest-sidebar-${viewport.width}x${viewport.height}`, record);
          if (viewport.height < 500) {
            const login = page
              .locator(".kova-sidebar")
              .getByRole("button", { name: "Log in to KovaGPT", exact: true });
            await login.scrollIntoViewIfNeeded();
            const b = await login.boundingBox();
            expect(b.y).toBeGreaterThanOrEqual(0);
            expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
            await capture(page, "guest-landscape-sidebar-footer", record);
          }
          await closeSidebar(page);
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openSidebar(page);
        expect(
          await page
            .locator(".kova-sidebar")
            .evaluate((element) => getComputedStyle(element).transitionDuration),
        ).toBe("0s");
        record.controls.push(
          "320px tablet landscape",
          "landscape footer reachable",
          "reduced motion",
        );
      }
      expect(record.pageErrors).toEqual([]);
    } catch (error) {
      report.failures.push({ account: config.account, error: error.message });
      await page
        .screenshot({ path: resolve(output, `${config.account}-failure.png`), fullPage: true })
        .catch(() => {});
    } finally {
      await context.close();
      await browser.close();
      browser = undefined;
    }
  }
} catch (error) {
  report.failures.push({ stage: "startup", error: error.message });
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await writeFile(resolve(output, "audit.json"), JSON.stringify(report, null, 2));
  if (!report.failures.length)
    for (const file of await readdir(output))
      if (file.endsWith("-failure.png")) await unlink(resolve(output, file));
  console.log(
    JSON.stringify(
      {
        output,
        cases: report.cases.length,
        pages: report.cases.reduce((count, item) => count + item.pages.length, 0),
        failures: report.failures,
        externalRequestsBlocked: report.blockedExternal.length,
        expectedUnavailable: report.unavailable.length,
      },
      null,
      2,
    ),
  );
  if (report.failures.length) process.exitCode = 1;
}
